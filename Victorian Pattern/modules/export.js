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
      reflectedChains,
      shouldSuppressUnresolvedCurl,
      helpers,
    } = config;

    const ink = invertPreview ? "#141413" : "#e9e7df";
    let body = "";

    for (const chain of model.chains) {
      if (shouldSuppressUnresolvedCurl(chain)) {
        continue;
      }
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
