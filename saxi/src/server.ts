/**
 * Backend web server for controlling the EBB.
 * Serve both the front end UI as static files - made with React, and backend
 * API for controlling the EBB.
 * Keep open web sockets to the front end for real-time updates.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoDetect } from "@serialport/bindings-cpp";
import type { PortInfo } from "@serialport/bindings-interface";
import cors from "cors";
import type { Request, Response } from "express";
import express from "express";
import { flattenSVG } from "flatten-svg";
import { createSVGWindow } from "svgdom";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { createMockSerialPort } from "./__tests__/mocks/serialport.js";
import { EBB, type EBBPort, type Hardware } from "./ebb.js";
import { PaperSize } from "./paper-size.js";
import { Device, defaultPlanOptions, type Motion, PenMotion, plan as buildPlan, Plan } from "./planning.js";
import { SerialPortSerialPort } from "./serialport-serialport.js";
import * as _self from "./server.js"; // use self-import for test mocking
import { formatDuration } from "./util.js";
import { vmul } from "./vec.js";

type Com = string;

/**
 * Shorthand for getting the device info, either EBB or com port.
 * @param ebb
 * @param com
 * @returns
 */
const getDeviceInfo = (ebb: EBB | null, _com: Com) => {
  // biome-ignore lint/suspicious/noExplicitAny: private member access
  const portPath = (ebb?.port as any)?._path ?? null;
  return { path: portPath, hardware: ebb?.hardware };
};

type IncomingSvgPayload = {
  svg: string;
  paperSize?: { x?: number; y?: number };
  marginMm?: number;
};

type PlanOptionsSyncPayload = {
  paperSize: { x: number; y: number };
  marginMm: number;
};

const SVG_UNITS_PER_MM = 96 / 25.4;

function parseSvgRoot(svg: string) {
  const window = createSVGWindow();
  window.document.documentElement.innerHTML = svg;
  const root = window.document.documentElement.firstElementChild;
  if (root?.nodeName?.toLowerCase() === "svg") return root as SVGElement;
  return window.document.documentElement;
}

function dimensionToMm(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(mm|cm|in|px)?\s*$/i.exec(String(value));
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = (match[2] || "mm").toLowerCase();
  if (!Number.isFinite(amount)) return fallback;
  if (unit === "cm") return amount * 10;
  if (unit === "in") return amount * 25.4;
  if (unit === "px") return (amount * 25.4) / 96;
  return amount;
}

function parseViewBox(svgRoot: SVGElement): [number, number, number, number] | null {
  const viewBox = svgRoot.getAttribute("viewBox");
  if (!viewBox) return null;
  const nums = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length !== 4) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

function inferPaperSize(svgRoot: SVGElement, payload?: IncomingSvgPayload): PaperSize {
  const payloadX = Number(payload?.paperSize?.x);
  const payloadY = Number(payload?.paperSize?.y);
  if (Number.isFinite(payloadX) && Number.isFinite(payloadY) && payloadX > 0 && payloadY > 0) {
    return new PaperSize({ x: payloadX, y: payloadY });
  }
  const widthMm = dimensionToMm(svgRoot.getAttribute("width"), defaultPlanOptions.paperSize.size.x);
  const heightMm = dimensionToMm(svgRoot.getAttribute("height"), defaultPlanOptions.paperSize.size.y);
  if (svgRoot.hasAttribute("width") || svgRoot.hasAttribute("height")) {
    return new PaperSize({ x: widthMm, y: heightMm });
  }
  const viewBox = parseViewBox(svgRoot);
  if (viewBox && viewBox[2] > 0 && viewBox[3] > 0) {
    return new PaperSize({ x: viewBox[2] / SVG_UNITS_PER_MM, y: viewBox[3] / SVG_UNITS_PER_MM });
  }
  return new PaperSize({ x: widthMm, y: heightMm });
}

function getSvgPointScale(svgRoot: SVGElement, paperSize: PaperSize) {
  const viewBox = parseViewBox(svgRoot);
  if (viewBox && viewBox[2] > 0 && viewBox[3] > 0) {
    return {
      offsetX: viewBox[0],
      offsetY: viewBox[1],
      scaleX: paperSize.size.x / viewBox[2],
      scaleY: paperSize.size.y / viewBox[3],
    };
  }
  return {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

function svgPointToMm(
  point: { x: number; y: number } | [number, number],
  pointScale: { offsetX: number; offsetY: number; scaleX: number; scaleY: number },
) {
  const x = Array.isArray(point) ? point[0] : point.x;
  const y = Array.isArray(point) ? point[1] : point.y;
  return {
    x: (x - pointScale.offsetX) * pointScale.scaleX,
    y: (y - pointScale.offsetY) * pointScale.scaleY,
  };
}

function composerSvgToPlan(payload: IncomingSvgPayload, hardware: Hardware): Plan {
  const svgRoot = parseSvgRoot(payload.svg);
  const flattened = flattenSVG(svgRoot, {});
  const paperSize = inferPaperSize(svgRoot, payload);
  const pointScale = getSvgPointScale(svgRoot, paperSize);
  const mmPaths = flattened
    .map((path) => path.points.map((point) => svgPointToMm(point, pointScale)))
    .filter((points) => points.length > 1);
  const planOptions = {
    ...defaultPlanOptions,
    hardware,
    paperSize,
    marginMm: Math.max(0, Number(payload.marginMm) || 0),
    selectedGroupLayers: new Set<string>(),
    selectedStrokeLayers: new Set<string>(),
    layerMode: "all" as const,
    sortPaths: false,
    fitPage: false,
    cropToMargins: false,
  };
  const device = Device(planOptions.hardware);
  const steppedPaths = mmPaths.map((points) => points.map((point) => vmul(point, device.stepsPerMm)));
  return buildPlan(
    steppedPaths,
    {
      penUpPos: device.penPctToPos(planOptions.penUpHeight),
      penDownPos: device.penPctToPos(planOptions.penDownHeight),
      penDownProfile: {
        acceleration: planOptions.penDownAcceleration * device.stepsPerMm,
        maximumVelocity: planOptions.penDownMaxVelocity * device.stepsPerMm,
        corneringFactor: planOptions.penDownCorneringFactor * device.stepsPerMm,
      },
      penUpProfile: {
        acceleration: planOptions.penUpAcceleration * device.stepsPerMm,
        maximumVelocity: planOptions.penUpMaxVelocity * device.stepsPerMm,
        corneringFactor: 0,
      },
      penDropDuration: planOptions.penDropDuration,
      penLiftDuration: planOptions.penLiftDuration,
    },
    vmul(planOptions.penHome, device.stepsPerMm),
  );
}

/**
 * Start the express server.
 * @param port
 * @param hardware
 * @param com
 * @param enableCors
 * @param maxPayloadSize
 * @returns
 */
export async function startServer(
  port: number,
  hardware: Hardware = "v3",
  com: Com = "",
  enableCors = false,
  maxPayloadSize = "200mb",
  svgIoApiKey = "",
) {
  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use("/", express.static(path.join(__dirname, "..", "ui")));
  app.use(express.json({ limit: maxPayloadSize }));
  if (enableCors) {
    app.use(cors());
  }
  // Web and Socket server
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  let ebb: EBB | null;
  let clients: WebSocket[] = [];
  let unpaused: Promise<void> | null = null;
  let signalUnpause: (() => void) | null = null;
  let motionIdx: number | null = null;
  let currentPlan: Plan | null = null;
  let latestIncomingSvg: string | null = null;
  let latestPlanOptions: PlanOptionsSyncPayload = {
    paperSize: {
      x: defaultPlanOptions.paperSize.size.x,
      y: defaultPlanOptions.paperSize.size.y,
    },
    marginMm: defaultPlanOptions.marginMm,
  };
  let plotting = false;
  let controller: AbortController | null = null;

  async function executePlan(plan: Plan) {
    if (plotting) {
      throw new Error("Plot in progress");
    }
    plotting = true;
    controller = new AbortController();
    const { signal } = controller;
    try {
      currentPlan = plan;
      console.log(`Received plan of estimated duration ${formatDuration(plan.duration())}`);
      console.log(ebb !== null ? "Beginning plot..." : "Simulating plot...");

      const begin = Date.now();
      let wakeLock: { release(): void } | null = null;
      if (process.platform === "darwin") {
        try {
          const { WakeLock } = await import("wake-lock");
          wakeLock = new WakeLock("saxi plotting");
        } catch (_error) {
          console.warn("Couldn't acquire wake lock. Ensure your machine does not sleep during plotting");
        }
      } else {
        console.log("Wake lock not available on this platform. Ensure your machine does not sleep during plotting");
      }
      try {
        const plotEbb = ebb ?? new EBB(createMockSerialPort() as unknown as EBBPort);
        await doPlot(createPlotter(plotEbb), plan, signal);
        const end = Date.now();
        console.log(`Plot took ${formatDuration((end - begin) / 1000)}`);
      } finally {
        wakeLock?.release();
      }
    } finally {
      plotting = false;
      controller = null;
    }
  }

  wss.on("connection", (ws) => {
    clients.push(ws);
    ws.on("message", (message) => {
      const msg = JSON.parse(message.toString());
      switch (msg.c) {
        case "ping":
          ws.send(JSON.stringify({ c: "pong" }));
          break;
        case "limp":
          if (ebb) {
            ebb.disableMotors();
          }
          break;
        case "setPenHeight":
          if (ebb) {
            (async () => {
              if (await ebb.supportsSR()) {
                await ebb.setServoPowerTimeout(10000, true);
              }
                await ebb.setPenHeight(msg.p.height, msg.p.rate);
            })();
          }
          break;
        case "incoming-svg":
          if (typeof msg.p?.svg === "string") {
            latestIncomingSvg = msg.p.svg;
            broadcast({ c: "incoming-svg", p: { svg: msg.p.svg } });
          }
          break;
        case "plan-options":
          if (
            msg.p?.paperSize != null &&
            Number.isFinite(msg.p.paperSize.x) &&
            Number.isFinite(msg.p.paperSize.y) &&
            Number.isFinite(msg.p.marginMm)
          ) {
            latestPlanOptions = {
              paperSize: {
                x: Number(msg.p.paperSize.x),
                y: Number(msg.p.paperSize.y),
              },
              marginMm: Number(msg.p.marginMm),
            };
            broadcast({ c: "plan-options", p: latestPlanOptions });
          }
          break;
        case "changeHardware":
          ebb?.changeHardware(msg.p.hardware);
          broadcast({ c: "dev", p: getDeviceInfo(ebb, com) });
          break;
      }
    });

    // send starting params to clients
    ws.send(JSON.stringify({ c: "dev", p: getDeviceInfo(ebb, com) }));

    ws.send(JSON.stringify({ c: "svgio-enabled", p: svgIoApiKey !== "" }));

    ws.send(JSON.stringify({ c: "pause", p: { paused: !!unpaused } }));
    if (motionIdx !== null) {
      ws.send(JSON.stringify({ c: "progress", p: { motionIdx } }));
    }
    if (currentPlan !== null) {
      ws.send(JSON.stringify({ c: "plan", p: { motions: currentPlan.toTransferable() } }));
    }
    if (latestPlanOptions != null) {
      ws.send(JSON.stringify({ c: "plan-options", p: latestPlanOptions }));
    }
    if (latestIncomingSvg != null) {
      ws.send(JSON.stringify({ c: "incoming-svg", p: { svg: latestIncomingSvg } }));
    }

    ws.on("close", () => {
      clients = clients.filter((w) => w !== ws);
    });
  });

  /**
   * /plot POST endpoint. Receive a plan on the POST body, and execute it.
   */
  app.post("/plot", async (req: Request, res: Response) => {
    try {
      const plan = Plan.deserialize(req.body);
      res.status(200).end();
      await executePlan(plan);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.status(nextError === "Plot in progress" ? 400 : 500).send(nextError);
      }
      if (nextError !== "Plot in progress") {
        console.error(nextError);
      }
    }
  });

  app.post("/incoming-svg", async (req: Request, res: Response) => {
    try {
      if (typeof req.body?.svg === "string") {
        latestIncomingSvg = req.body.svg;
        broadcast({ c: "incoming-svg", p: { svg: req.body.svg } });
      }
      res.status(200).end();
    } catch (error) {
      const nextError = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.status(500).send(nextError);
      }
      console.error(`Error processing incoming SVG: ${nextError}`);
    }
  });

  app.get("/plot/status", (_req, res) => {
    res.json({ plotting });
  });

  app.post("/cancel", (_req: Request, res: Response) => {
    if (controller) {
      controller.abort();
      controller = null;
    }
    ebb?.cancel();
    if (unpaused) {
      signalUnpause?.();
      broadcast({ c: "pause", p: { paused: false } });
    }
    unpaused = signalUnpause = null;
    res.status(200).end();
  });

  app.post("/pause", (_req: Request, res: Response) => {
    if (!unpaused) {
      unpaused = new Promise((resolve) => {
        signalUnpause = resolve;
      });
      broadcast({ c: "pause", p: { paused: true } });
    }
    res.status(200).end();
  });

  app.post("/resume", (_req: Request, res: Response) => {
    if (signalUnpause) {
      signalUnpause();
      signalUnpause = unpaused = null;
    }
    res.status(200).end();
  });

  app.post("/generate", async (req: Request, res: Response) => {
    if (plotting) {
      console.log("Received generate request, but a plot is already in progress!");
      res.status(400).end("Plot in progress");
      return;
    }
    const { prompt, vecType } = req.body;
    try {
      // call the api and return the svg
      const apiResp = await fetch("https://api.svg.io/v1/generate-image", {
        method: "post",
        headers: {
          Authorization: `Bearer ${svgIoApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, style: vecType, negativePrompt: "" }),
      });
      // forward the api response
      const data = await apiResp.json();
      res.status(apiResp.status).send(data);
    } catch (err) {
      console.error(err);
      res.status(500).end();
    }
  });

  function broadcast(msg: Record<string, unknown>) {
    for (const client of clients) {
      try {
        client.send(JSON.stringify(msg));
      } catch (e) {
        console.warn(e);
      }
    }
  }

  interface Plotter {
    prePlot: (initialPenHeight: number) => Promise<void>;
    executeMotion: (m: Motion, progress: [number, number]) => Promise<void>;
    postCancel: (initialPenHeight: number) => Promise<void>;
    postPlot: () => Promise<void>;
  }

  function createPlotter(ebb: EBB): Plotter {
    return {
      async prePlot(initialPenHeight: number): Promise<void> {
        await ebb.configureFifoDepth();
        await ebb.enableMotors(1); // 16x microstepping, matches defaults from Axidraw
        await ebb.setPenHeight(initialPenHeight, 1000, 1000);
      },
      async executeMotion(motion: Motion, _progress: [number, number]): Promise<void> {
        await ebb.executeMotion(motion);
      },
      async postCancel(initialPenHeight: number): Promise<void> {
        await ebb.setPenHeight(initialPenHeight, 1000);
        await ebb.command("HM,4000"); // HM returns carriage home without 3rd and 4th arguments
        // The board may still be executing motion queued in its FIFO; issuing
        // HM while moving makes the steppers grind against whatever they're doing.
        await ebb.waitUntilMotorsIdle();
      },
      async postPlot(): Promise<void> {
        await ebb.waitUntilMotorsIdle();
        await ebb.disableMotors();
      },
    };
  }

  async function doPlot(plotter: Plotter, plan: Plan, signal: AbortSignal): Promise<void> {
    const abortPromise = onceAbort(signal); // reuse abort promise
    unpaused = null;
    signalUnpause = null;
    motionIdx = 0;

    const firstPenMotion = plan.motions.find((x) => x instanceof PenMotion) as PenMotion;
    await plotter.prePlot(firstPenMotion.initialPos);

    let penIsUp = true;
    try {
      for (const motion of plan.motions) {
        broadcast({ c: "progress", p: { motionIdx } });

        await Promise.race([plotter.executeMotion(motion, [motionIdx, plan.motions.length]), abortPromise]);

        if (motion instanceof PenMotion) {
          penIsUp = motion.initialPos < motion.finalPos;
        }

        if (unpaused && penIsUp) {
          await Promise.race([unpaused, abortPromise]);
          broadcast({ c: "pause", p: { paused: false } });
        }

        motionIdx += 1;
      }

      broadcast({ c: "finished" });
    } catch (err) {
      if (signal.aborted) {
        await plotter.postCancel(firstPenMotion.initialPos);
        broadcast({ c: "cancelled" });
        return;
      }
      throw err; // propagate real errors
    } finally {
      motionIdx = null;
      currentPlan = null;
      await plotter.postPlot();
    }
  }

  function onceAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      signal.throwIfAborted();
      signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
  }

  return new Promise<http.Server>((resolve) => {
    server.listen(port, () => {
      async function connect() {
        const devices = ebbs(com, hardware);
        for await (const device of devices) {
          ebb = device;
          broadcast({ c: "dev", p: getDeviceInfo(ebb, com) });
        }
      }
      connect();
      const { family, address, port } = server.address() as AddressInfo;
      const addr = `${family === "IPv6" ? `[${address}]` : address}:${port}`;
      console.log(`Server listening on http://${addr}`);
      resolve(server);
    });
  });
}

async function tryOpen(com: Com) {
  const port = new SerialPortSerialPort(com);
  await port.open({ baudRate: 9600 });
  if (!port.readable || !port.writable) {
    throw new Error("Serial port opened but readable/writable streams are unavailable");
  }
  return port;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEBB(p: PortInfo): boolean {
  return (
    p.manufacturer === "SchmalzHaus" ||
    p.manufacturer === "SchmalzHaus LLC" ||
    (p.vendorId === "04D8" && p.productId === "FD92")
  );
}

async function listEBBs() {
  const Binding = autoDetect();
  const ports = await Binding.list();
  return ports.filter(isEBB).map((p: { path: string }) => p.path);
}

export async function waitForEbb(): Promise<Com> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ebbs = await listEBBs();
    if (ebbs.length) {
      return ebbs[0];
    }
    await sleep(5000);
  }
}

async function* ebbs(path?: string, hardware: Hardware = "v3") {
  while (true) {
    try {
      const com: Com = path || (await _self.waitForEbb()); // use self-import for test mocking
      console.log(`Found EBB at ${com}`);
      const port = await tryOpen(com);
      const closed = new Promise((resolve) => {
        port.addEventListener("disconnect", resolve, { once: true });
      });
      yield new EBB(port, hardware);
      await closed;
      yield null;
      console.error("Lost connection to EBB, reconnecting...");
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`Error connecting to EBB: ${err.message}`);
      console.error("Retrying in 5 seconds...");
      await sleep(5000);
    }
  }
}

export async function connectEBB(hardware: Hardware, device?: string): Promise<EBB | null> {
  const dev = device ?? (await listEBBs())[0];
  if (!dev) return null;

  const port = await tryOpen(dev);
  return new EBB(port, hardware);
}
