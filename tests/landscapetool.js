// The landscape import (tools/landscape.js), run against made-up WorldCover tiles served from this
// computer: "read" in two parts and "pack" (the main class of each square, water not counting, tiles of
// 10°, the file format the pages read), and broken input, which must stop without writing anything.
// Needs no browser and no network.
const { spawn } = require("child_process");
const fs = require("fs"),
  http = require("http"),
  os = require("os"),
  path = require("path"),
  zlib = require("zlib");

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const tool = path.join(__dirname, "../tools/landscape.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "landscape-test-"));

/* Runs the tool; resolves to { status, output }. (Not spawnSync: the server below must keep answering.) */
const run = args =>
  new Promise(resolve => {
    const p = spawn(process.execPath, [tool, ...args]);
    let output = "";
    p.stdout.on("data", d => (output += d));
    p.stderr.on("data", d => (output += d));
    p.on("close", status => resolve({ status, output }));
  });

(async () => {
  const { writeArrayBuffer } = await import("geotiff");
  /* A made-up WorldCover tile of 3° at 1,440 pixels across (4 to a square of 1/120°): fill(row, col)
     gives each pixel's class. */
  const W = 1440;
  const tile = (west, south, fill) => {
    const v = new Uint8Array(W * W);
    for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) v[r * W + c] = fill(r, c);
    return Buffer.from(
      writeArrayBuffer(v, {
        width: W,
        height: W,
        BitsPerSample: [8],
        SampleFormat: [1],
        ModelPixelScale: [3 / W, 3 / W, 0],
        ModelTiepoint: [0, 0, 0, west, south + 3, 0],
        GeographicTypeGeoKey: 4326,
        GTModelTypeGeoKey: 2,
        GTRasterTypeGeoKey: 1,
      }),
    );
  };
  const files = {
    // 51–54° N, 9–12° E: forest in the west half, farmland in the east; the northern 20 pixel rows water
    // (five rows of squares), the row of squares below half water, half forest. One square near the
    // middle: 10 of its 16 pixels farmland, 6 forest.
    N51E009: tile(9, 51, (r, c) => {
      if (r < 20) return 80;
      if (r < 22) return 80;
      if (r >= 400 && r < 404 && c >= 400 && c < 404) return r < 402 || (r === 402 && c < 402) ? 40 : 10;
      return c < W / 2 ? 10 : 40;
    }),
    // 48–51° N, 9–12° E: grassland in the north half, built-up in the south
    N48E009: tile(9, 48, r => (r < W / 2 ? 30 : 50)),
  };
  const bad = {
    // values WorldCover does not have, everywhere
    N45E009: tile(9, 45, () => 25),
    // a tile that is not where its name says
    N42E009: tile(9, 51, () => 10),
  };
  const served = { ...files, ...bad };
  const server = http.createServer((req, res) => {
    const name = /ESA_WorldCover_10m_2021_v200_(\w+)_Map\.tif$/.exec(req.url)?.[1];
    const data = served[name];
    if (!data) {
      res.writeHead(403); // as Amazon answers for a file that is not there
      return res.end();
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Length": data.length, "Accept-Ranges": "bytes" });
      return res.end();
    }
    if (range) {
      const start = +range[1],
        end = Math.min(data.length - 1, range[2] ? +range[2] : data.length - 1);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { "Content-Length": data.length });
    res.end(data);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const source = `http://127.0.0.1:${server.address().port}/v200/2021/map/`;

  // read, in two parts; one tile name that does not exist
  const parts = path.join(work, "parts");
  const only = "N51E009,N48E009,N00E000";
  const a = await run(["read", "--part", "0/2", "--out", parts, "--source", source, "--only", only]);
  const b = await run(["read", "--part", "1/2", "--out", parts, "--source", source, "--only", only]);
  ok(
    a.status === 0 && b.status === 0,
    "read, in two parts: " + (a.status || b.status ? a.output + b.output : "ok"),
  );
  const partFiles = fs.readdirSync(parts).sort().join();
  ok(
    partFiles === "N48E009.bin,N51E009.bin,part-0.json,part-1.json",
    "one file per tile that exists, and one per part: " + partFiles,
  );
  const squares = zlib.gunzipSync(fs.readFileSync(path.join(parts, "N51E009.bin")));
  ok(squares.length === 360 * 360, "360 × 360 squares to a 3° tile");
  ok(
    squares[0] === 0 && squares[4 * 360] === 0 && squares[5 * 360] === 1 && squares[5 * 360 + 359] === 2,
    "all water: nothing; half water: the land beside it",
  );
  ok(squares[100 * 360 + 100] === 2, "a square of 10 farmland and 6 forest pixels: farmland");
  ok(
    squares[200 * 360 + 10] === 1 && squares[200 * 360 + 350] === 2,
    "forest in the west, farmland in the east",
  );

  // pack: tiles of 10°, the format the pages read
  const out = path.join(work, "out");
  const summary = path.join(work, "summary.md");
  const p = await run(["pack", parts, "--out", out, "--summary", summary, "--min-tiles", "1"]);
  ok(p.status === 0, "pack: " + p.output.trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "landscape.json"), "utf8"));
  ok(
    Object.keys(manifest.tiles).sort().join() === "N40E000,N40E010,N50E000,N50E010",
    "the 10° tiles the two cover: " + Object.keys(manifest.tiles).join(),
  );
  ok(
    manifest.grid.cellsPerDegree === 120 &&
      manifest.grid.tileDegrees === 10 &&
      manifest.classes.join() === ",forest,farmland,grassland,bare,built-up,other" &&
      manifest.source.licence === "CC BY 4.0",
    "the grid, the classes and the source",
  );
  /* The class at a place, read as a page reads it: stretches of (length × 8 + class) per row. */
  const at = (lat, lng) => {
    const south = Math.floor(lat / 10) * 10,
      west = Math.floor(lng / 10) * 10;
    const key = `${south < 0 ? "S" : "N"}${String(Math.abs(south)).padStart(2, "0")}${west < 0 ? "W" : "E"}${String(Math.abs(west)).padStart(3, "0")}`;
    const file = path.join(out, "landscape", key + ".bin");
    if (!fs.existsSync(file)) return "no tile";
    const bytes = zlib.inflateSync(fs.readFileSync(file));
    const row = Math.floor((south + 10 - lat) * 120),
      col = Math.floor((lng - west) * 120);
    let i = 0,
      r = 0,
      c = 0;
    while (i < bytes.length) {
      let v = 0,
        shift = 1,
        x;
      do {
        x = bytes[i++];
        v += (x & 127) * shift;
        shift *= 128;
      } while (x & 128);
      const n = Math.floor(v / 8);
      if (r === row && col >= c && col < c + n) return manifest.classes[v % 8] || "nothing";
      c += n;
      if (c === 1200) {
        c = 0;
        r++;
      }
    }
    return "past the end";
  };
  const got = [
    [52.5, 9.5],
    [52.5, 11.5],
    [50.5, 9.5],
    [50.5, 10.5],
    [48.5, 9.5],
    [48.5, 11.5],
    [53.99, 9.5],
    [45, 5],
  ]
    .map(([lat, lng]) => at(lat, lng))
    .join();
  ok(
    got === "forest,farmland,grassland,grassland,built-up,built-up,nothing,nothing",
    "read back at known places, across the tiles' edges: " + got,
  );
  ok(
    fs.readdirSync(path.join(out, "landscape")).length === 4 &&
      manifest.bytes === Object.values(manifest.tiles).reduce((x, y) => x + y, 0),
    "one file per tile, the sizes add up",
  );
  const text = fs.readFileSync(summary, "utf8");
  ok(/2 WorldCover tiles read, 4 tiles of 10° written/.test(text), "the summary counts");
  ok(/the Sahara \(23, 12\): nothing \(expected bare\)/.test(text), "and lists the known places to look at");

  // Broken input stops, writing nothing
  const oddOut = path.join(work, "odd");
  const odd = await run(["read", "--part", "0/1", "--out", oddOut, "--source", source, "--only", "N45E009"]);
  ok(
    odd.status !== 0 &&
      /values WorldCover does not have/.test(odd.output) &&
      !fs.existsSync(path.join(oddOut, "part-0.json")),
    "values WorldCover does not have: stops",
  );
  const wrong = await run([
    "read",
    "--part",
    "0/1",
    "--out",
    oddOut,
    "--source",
    source,
    "--only",
    "N42E009",
  ]);
  ok(wrong.status !== 0 && /not its 3° tile/.test(wrong.output), "a tile in the wrong place: stops");
  const few = await run(["pack", parts, "--out", path.join(work, "few")]);
  ok(
    few.status !== 0 && /only 2 WorldCover tiles/.test(few.output) && !fs.existsSync(path.join(work, "few")),
    "too few tiles for the world: stops",
  );
  fs.rmSync(path.join(parts, "part-1.json"));
  const missing = await run(["pack", parts, "--out", path.join(work, "missing"), "--min-tiles", "1"]);
  ok(missing.status !== 0 && /found 1 parts, expected 2/.test(missing.output), "a part missing: stops");

  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
