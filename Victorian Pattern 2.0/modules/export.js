(function attachVictorianPatternExport(global) {
  function fmt(value) {
    return Math.round(value * 1000) / 1000;
  }

  function arcsToPath(arcs, arcPointAt) {
    const start = arcPointAt(arcs[0], 0);
    let path = `M ${fmt(start[0])} ${fmt(start[1])}`;

    for (const arc of arcs) {
      const end = arcPointAt(arc, 1);
      const large = Math.abs(arc.da) > Math.PI ? 1 : 0;
      const sweep = arc.da > 0 ? 1 : 0;
      path += ` A ${fmt(arc.r)} ${fmt(arc.r)} 0 ${large} ${sweep} ${fmt(end[0])} ${fmt(end[1])}`;
    }

    return path;
  }

  function arcsToContinuation(arcs, arcPointAt) {
    let path = "";

    for (const arc of arcs) {
      const end = arcPointAt(arc, 1);
      const large = Math.abs(arc.da) > Math.PI ? 1 : 0;
      const sweep = arc.da > 0 ? 1 : 0;
      path += ` A ${fmt(arc.r)} ${fmt(arc.r)} 0 ${large} ${sweep} ${fmt(end[0])} ${fmt(end[1])}`;
    }

    return path;
  }

  function chainToSvg(chain, helpers) {
    const { arcPointAt, reverseArcs } = helpers;
    let output = "";

    if (chain.kind === "stroke") {
      if (chain.terminalLeaf && chain.terminalLeaf.outer?.length && chain.terminalLeaf.inner?.length) {
        const outerCount = chain.terminalLeaf.outer.length;
        const stemArcs = chain.arcs.slice(0, Math.max(0, chain.arcs.length - outerCount));
        const innerReverse = reverseArcs(chain.terminalLeaf.inner);
        let leafPath = "";

        if (stemArcs.length) {
          leafPath = `${arcsToPath(stemArcs, arcPointAt)}${arcsToContinuation(
            chain.terminalLeaf.outer,
            arcPointAt
          )}`;
        } else {
          leafPath = arcsToPath(chain.terminalLeaf.outer, arcPointAt);
        }

        leafPath += arcsToContinuation(innerReverse, arcPointAt);
        output += `<path d="${leafPath}"/>\n`;
      } else {
        output += `<path d="${arcsToPath(chain.arcs, arcPointAt)}"/>\n`;
      }
      const last = chain.arcs[chain.arcs.length - 1];
      if (last.r < 6 && !chain.terminalLeaf) {
        const end = arcPointAt(last, 1);
        output += `<circle cx="${fmt(end[0])}" cy="${fmt(end[1])}" r="${fmt(Math.max(1.2, chain.wBase * 0.3))}"/>\n`;
      }
    } else if (chain.kind === "leaf") {
      output += `<path d="${arcsToPath(chain.stem, arcPointAt)}"/>\n`;
      const start = arcPointAt(chain.tear[0], 0);
      let path = `M ${fmt(start[0])} ${fmt(start[1])}`;
      const arcA = chain.tear[0];
      const arcB = reverseArcs([chain.tear[1]])[0];
      const arcAEnd = arcPointAt(arcA, 1);
      path += ` A ${fmt(arcA.r)} ${fmt(arcA.r)} 0 0 ${arcA.da > 0 ? 1 : 0} ${fmt(arcAEnd[0])} ${fmt(arcAEnd[1])}`;
      const arcBEnd = arcPointAt(arcB, 1);
      path += ` A ${fmt(arcB.r)} ${fmt(arcB.r)} 0 0 ${arcB.da > 0 ? 1 : 0} ${fmt(arcBEnd[0])} ${fmt(arcBEnd[1])} Z`;
      output += `<path d="${path}"/>\n`;
    }

    return output;
  }

  function orderChainsForGrowth(chains) {
    const byId = new Map();
    const childrenByParent = new Map();
    const ordered = [];
    const visited = new Set();
    const chainSizeScore = (chain) => {
      const arcLength =
        chain.kind === "stroke"
          ? chain.arcs.reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
          : chain.kind === "leaf"
            ? chain.stem.concat(chain.tear).reduce((sum, arc) => sum + Math.abs(arc.da) * arc.r, 0)
            : 0;
      return (chain.wBase ?? 0) * 10000 + arcLength;
    };
    const sortByHierarchy = (a, b) =>
      chainSizeScore(b) - chainSizeScore(a) || (a.createdIndex ?? 0) - (b.createdIndex ?? 0);

    for (const chain of chains) {
      byId.set(chain.chainId, chain);
    }

    for (const chain of chains) {
      const parentId = chain.parentId;
      if (!parentId || !byId.has(parentId)) {
        continue;
      }
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(chain);
      childrenByParent.set(parentId, siblings);
    }

    for (const siblings of childrenByParent.values()) {
      siblings.sort(sortByHierarchy);
    }

    const visit = (chain) => {
      if (!chain || visited.has(chain.chainId)) {
        return;
      }
      visited.add(chain.chainId);
      ordered.push(chain);
      for (const child of childrenByParent.get(chain.chainId) ?? []) {
        visit(child);
      }
    };

    const roots = chains
      .filter((chain) => !chain.parentId || !byId.has(chain.parentId))
      .sort(sortByHierarchy);

    for (const root of roots) {
      visit(root);
    }

    for (const chain of [...chains].sort(sortByHierarchy)) {
      visit(chain);
    }

    return ordered;
  }

  function voidMaskToSvg(voidMask, fillColor, width, height) {
    if (!voidMask) {
      return "";
    }
    if (voidMask.shape === "rectOvalIntersect") {
      if (voidMask.invertRectOval) {
        return `<g id="void-mask">
  <path fill="${fillColor}" stroke="none" fill-rule="evenodd" d="M ${fmt(voidMask.rectX)} ${fmt(
          voidMask.rectY
        )} H ${fmt(voidMask.rectX + voidMask.rectWidth)} V ${fmt(
          voidMask.rectY + voidMask.rectHeight
        )} H ${fmt(voidMask.rectX)} Z M ${fmt(voidMask.ovalCx + voidMask.ovalRx)} ${fmt(
          voidMask.ovalCy
        )} A ${fmt(voidMask.ovalRx)} ${fmt(voidMask.ovalRy)} 0 1 0 ${fmt(
          voidMask.ovalCx - voidMask.ovalRx
        )} ${fmt(voidMask.ovalCy)} A ${fmt(voidMask.ovalRx)} ${fmt(voidMask.ovalRy)} 0 1 0 ${fmt(
          voidMask.ovalCx + voidMask.ovalRx
        )} ${fmt(voidMask.ovalCy)} Z"/>
</g>\n`;
      }
      return `<g id="void-mask">
  <defs>
    <clipPath id="mask-rect-clip">
      <rect x="${fmt(voidMask.rectX)}" y="${fmt(voidMask.rectY)}" width="${fmt(voidMask.rectWidth)}" height="${fmt(
        voidMask.rectHeight
      )}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#mask-rect-clip)">
    <ellipse cx="${fmt(voidMask.ovalCx)}" cy="${fmt(voidMask.ovalCy)}" rx="${fmt(voidMask.ovalRx)}" ry="${fmt(
        voidMask.ovalRy
      )}" fill="${fillColor}" stroke="none"/>
  </g>
</g>\n`;
    }
    if (voidMask.shape === "rect") {
      return `<g id="void-mask"><rect x="${fmt(voidMask.x)}" y="${fmt(voidMask.y)}" width="${fmt(
        voidMask.width
      )}" height="${fmt(voidMask.height)}" fill="${fillColor}" stroke="none"/></g>\n`;
    }
    return `<g id="void-mask"><ellipse cx="${fmt(voidMask.cx)}" cy="${fmt(voidMask.cy)}" rx="${fmt(
      voidMask.rx
    )}" ry="${fmt(voidMask.ry)}" fill="${fillColor}" stroke="none"/></g>\n`;
  }

  function voidBoundaryToSvg(voidMask) {
    if (!voidMask) {
      return "";
    }
    if (voidMask.shape === "rectOvalIntersect") {
      return `<g>
  <defs>
    <clipPath id="boundary-rect-clip">
      <rect x="${fmt(voidMask.rectX)}" y="${fmt(voidMask.rectY)}" width="${fmt(voidMask.rectWidth)}" height="${fmt(
        voidMask.rectHeight
      )}"/>
    </clipPath>
    <clipPath id="boundary-oval-clip">
      <ellipse cx="${fmt(voidMask.ovalCx)}" cy="${fmt(voidMask.ovalCy)}" rx="${fmt(voidMask.ovalRx)}" ry="${fmt(
        voidMask.ovalRy
      )}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#boundary-oval-clip)">
    <rect x="${fmt(voidMask.rectX)}" y="${fmt(voidMask.rectY)}" width="${fmt(voidMask.rectWidth)}" height="${fmt(
        voidMask.rectHeight
      )}"/>
  </g>
  <g clip-path="url(#boundary-rect-clip)">
    <ellipse cx="${fmt(voidMask.ovalCx)}" cy="${fmt(voidMask.ovalCy)}" rx="${fmt(voidMask.ovalRx)}" ry="${fmt(
        voidMask.ovalRy
      )}"/>
  </g>
</g>\n`;
    }
    if (voidMask.shape === "rect") {
      return `<rect x="${fmt(voidMask.x)}" y="${fmt(voidMask.y)}" width="${fmt(voidMask.width)}" height="${fmt(
        voidMask.height
      )}"/>\n`;
    }
    return `<ellipse cx="${fmt(voidMask.cx)}" cy="${fmt(voidMask.cy)}" rx="${fmt(voidMask.rx)}" ry="${fmt(
      voidMask.ry
    )}"/>\n`;
  }
  function downloadPng(saveCanvasFn, seed) {
    saveCanvasFn(`victorian-flourish-${seed}`, "png");
  }

  function downloadSvg(config) {
    const {
      width,
      height,
      seed,
      decay,
      invertPreview,
      model,
      voidMask,
      reflectedChains,
      shouldSuppressUnresolvedCurl,
      helpers,
    } = config;

    const ink = invertPreview ? "#141413" : "#e9e7df";
    const paper = invertPreview ? "#f6f4ee" : "#0e0e10";
    let body = "";
    const drawableChains = orderChainsForGrowth(
      model.chains.filter((chain) => !shouldSuppressUnresolvedCurl(chain))
    );

    for (const chain of drawableChains) {
      for (const reflected of reflectedChains(chain)) {
        body += chainToSvg(reflected, helpers);
      }
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<!-- Victorian Flourish Engine · seed ${seed} · decay ${decay}/quarter-turn -->
<!-- Centerline geometry: pure circular arcs (A commands) + circles. G1-continuous. -->
<g fill="none" stroke="${ink}" stroke-width="1" stroke-linecap="round">
${body}</g>
${voidMaskToSvg(voidMask, paper, width, height)}
<g id="void-boundary" fill="none" stroke="${ink}" stroke-width="1" stroke-linecap="round">
${voidBoundaryToSvg(voidMask)}</g>
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `victorian-flourish-${seed}.svg`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  global.VictorianPatternExport = {
    downloadPng,
    downloadSvg,
  };
})(window);
