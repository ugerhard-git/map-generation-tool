// The terrain import (tools/terrain.js), run against made-up DEM tiles served from this computer: "read"
// in two parts and "pack" (the relief around each square in bands, the sea as 0 m, tiles of 10°, the file
// format the pages read), and broken input, which must stop without writing anything. Needs no browser and
// no network.
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
const tool = path.join(__dirname, "../tools/terrain.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "terrain-test-"));
const run = args =>
  new Promise(resolve => {
    const p = spawn(process.execPath, [tool, ...args]);
    let output = "";
    p.stdout.on("data", d => (output += d));
    p.stderr.on("data", d => (output += d));
    p.on("close", status => resolve({ status, output }));
  });
const name = key => `Copernicus_DSM_COG_30_${key.slice(0, 3)}_00_${key.slice(3)}_00_DEM`;

(async () => {
  /* A GeoTIFF of 32-bit floats, as the DEM's (geotiff's own writer only writes bytes): one image per
     entry of `images` ({ width, height, values }), the first the full size and the others smaller copies
     inside it, as in a Cloud Optimized GeoTIFF; the first placed with its north-west corner at west, north,
     covering 1°. Uncompressed, one strip per image. */
  const geoTiff = (images, west, north) => {
    let size = 8;
    const layout = images.map((im, k) => {
      const tags = [
        [254, 4, [k ? 1 : 0]], // a smaller copy (overview) after the first
        [256, 4, [im.width]],
        [257, 4, [im.height]],
        [258, 3, [32]],
        [259, 3, [1]],
        [262, 3, [1]],
        [273, 4, [0]], // strip offset, set below
        [277, 3, [1]],
        [278, 4, [im.height]],
        [279, 4, [im.width * im.height * 4]],
        [284, 3, [1]],
        [339, 3, [3]], // floats
        ...(k
          ? []
          : [
              [33550, 12, [1 / im.width, 1 / im.height, 0]],
              [33922, 12, [0, 0, 0, west, north, 0]],
              [34735, 3, [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]],
            ]),
      ];
      const ifd = size;
      const extra = ifd + 2 + tags.length * 12 + 4;
      let at = extra;
      const placed = tags.map(([tag, type, values]) => {
        const bytes = values.length * (type === 12 ? 8 : type === 4 ? 4 : 2);
        const where = bytes > 4 ? at : null;
        if (where !== null) at += bytes + (bytes % 2);
        return { tag, type, values, where };
      });
      const data = at;
      size = data + im.width * im.height * 4;
      return { ifd, placed, data, im };
    });
    const buf = Buffer.alloc(size);
    buf.write("II", 0);
    buf.writeUInt16LE(42, 2);
    buf.writeUInt32LE(8, 4);
    layout.forEach(({ ifd, placed, data, im }, k) => {
      buf.writeUInt16LE(placed.length, ifd);
      placed.forEach(({ tag, type, values, where }, i) => {
        const e = ifd + 2 + i * 12;
        buf.writeUInt16LE(tag, e);
        buf.writeUInt16LE(type, e + 2);
        buf.writeUInt32LE(values.length, e + 4);
        if (tag === 273) values = [data];
        const put = (v, o) =>
          type === 12
            ? buf.writeDoubleLE(v, o)
            : type === 4
              ? buf.writeUInt32LE(v, o)
              : buf.writeUInt16LE(v, o);
        const size1 = type === 12 ? 8 : type === 4 ? 4 : 2;
        if (where === null) values.forEach((v, j) => put(v, e + 8 + j * size1));
        else {
          buf.writeUInt32LE(where, e + 8);
          values.forEach((v, j) => put(v, where + j * size1));
        }
      });
      buf.writeUInt32LE(k + 1 < layout.length ? layout[k + 1].ifd : 0, ifd + 2 + placed.length * 12);
      for (let i = 0; i < im.values.length; i++) buf.writeFloatLE(im.values[i], data + i * 4);
    });
    return buf;
  };
  /* A made-up DEM tile of 1°: 1,200 pixels north to south (3″, as the DEM's), 800 across, with smaller
     copies of 600 and 300 (the tool should read the one of 600, 6″); height(lat, lng) gives each pixel's
     height in metres. `at` puts it somewhere else than its name says. */
  const tile = (key, height, at = key) => {
    const south = (at[0] === "S" ? -1 : 1) * +at.slice(1, 3),
      west = (at[3] === "W" ? -1 : 1) * +at.slice(4);
    const image = (H, W, value) => {
      const values = new Float32Array(W * H);
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++)
          values[r * W + c] = value(south + 1 - (r + 0.5) / H, west + (c + 0.5) / W);
      return { width: W, height: H, values };
    };
    return geoTiff(
      [
        image(1200, 800, () => -99999), // the full size: never read (it would not be right)
        image(600, 400, height),
        image(300, 200, () => -99999), // too coarse: never read
      ],
      west,
      south + 1,
    );
  };
  const files = {
    // flat: 1 to 6 m (the sea, with no tile, to its west)
    N52E005: tile("N52E005", (lat, lng) => 1 + 5 * ((lng * 7) % 1)),
    // a slope east, 40 m a kilometre east to west (at 52.5° a degree is about 68 km)
    N52E006: tile("N52E006", (lat, lng) => (lng - 6) * 68 * 40),
    // mountains: 2,000 m, up and down by 800 m every few kilometres
    N46E007: tile("N46E007", (lat, lng) => 2000 + 800 * Math.sin(lat * 60) * Math.sin(lng * 40)),
  };
  const bad = {
    // heights that cannot be right
    N45E007: tile("N45E007", () => -32767),
    // a tile that is not where its name says
    N44E007: tile("N44E007", () => 10, "N46E007"),
  };
  const served = { ...files, ...bad };
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/tileList.txt")) {
      res.writeHead(200);
      return res.end(Object.keys(served).map(name).join("\n") + "\n");
    }
    const key = Object.keys(served).find(k => req.url.endsWith(`/${name(k)}/${name(k)}.tif`));
    const data = served[key];
    if (!data) {
      res.writeHead(403);
      return res.end();
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (range) {
      const start = +range[1],
        end = Math.min(data.length - 1, range[2] ? +range[2] : data.length - 1);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Content-Length": end - start + 1,
      });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { "Content-Length": data.length });
    res.end(data);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const source = `http://127.0.0.1:${server.address().port}/`;

  // read, in two parts
  const parts = path.join(work, "parts");
  const only = Object.keys(files).join(",");
  const a = await run(["read", "--part", "0/2", "--out", parts, "--source", source, "--only", only]);
  const b = await run(["read", "--part", "1/2", "--out", parts, "--source", source, "--only", only]);
  ok(
    a.status === 0 && b.status === 0,
    "read, in two parts: " + (a.status || b.status ? a.output + b.output : "ok"),
  );
  ok(
    fs.readdirSync(parts).sort().join() === "N46E007.bin,N52E005.bin,N52E006.bin,part-0.json,part-1.json",
    "one file per tile, and one per part",
  );
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(parts, "N52E005.bin")));
  const both = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  ok(
    both.length === 2 * 120 * 120 && both[0] >= 1 && both[14400] <= 7 && both[14400] >= both[0],
    `the lowest and highest height of each square: ${both[0]} to ${both[14400]} m`,
  );

  // pack
  const out = path.join(work, "out");
  const summary = path.join(work, "summary.md");
  const p = await run(["pack", parts, "--out", out, "--summary", summary, "--min-tiles", "1"]);
  ok(p.status === 0, "pack: " + p.output.trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "terrain.json"), "utf8"));
  ok(
    Object.keys(manifest.tiles).sort().join() === "N40E000,N50E000",
    "the 10° tiles they are in: " + Object.keys(manifest.tiles).join(),
  );
  ok(
    manifest.bands.map(x => x.from).join() === "0,15,30,50,100,200,300" &&
      manifest.radiusKm === 1.5 &&
      manifest.grid.cellsPerDegree === 120,
    "the bands, the radius and the grid",
  );
  /* The band at a place, read as a page reads it. */
  const at = (lat, lng) => {
    const south = Math.floor(lat / 10) * 10,
      west = Math.floor(lng / 10) * 10;
    const file = path.join(out, "terrain", `N${south}E${String(west).padStart(3, "0")}.bin`);
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
      if (r === row && col >= c && col < c + n) return v % 8;
      c += n;
      if (c === 1200) [c, r] = [0, r + 1];
    }
    return "past the end";
  };
  const got = {
    flat: at(52.5, 5.5),
    coast: at(52.5, 5.003),
    slope: at(52.5, 6.5),
    mountains: at(46.5, 7.5),
    sea: at(52.5, 4.5),
    edge: at(52.5, 5.999),
  };
  ok(got.flat === 1, "flat: under 15 m (band 1): " + got.flat);
  ok(got.coast === 1, "beside the sea, which counts as 0 m: still under 15 m: " + got.coast);
  ok(got.slope === 5, "40 m a kilometre, about 3 km across: 100–200 m (band 5): " + got.slope);
  ok(got.mountains === 7, "the mountains: 300 m or more (band 7): " + got.mountains);
  ok(got.sea === 0, "the sea: 0: " + got.sea);
  ok(got.edge >= 2, "where the flat tile meets the slope, the slope beside it counts: band " + got.edge);
  const text = fs.readFileSync(summary, "utf8");
  ok(/3 DEM tiles read, 2 tiles of 10° written/.test(text), "the summary counts");
  ok(/under 50 m [\d.]+%, 50–300 m [\d.]+%, 300 m or more [\d.]+%/.test(text), "and gives the three shares");
  ok(/Zermatt \(46.02, 7.75\): 300 m or more\n/.test(text), "and the known places: Zermatt in the mountains");
  ok(/Iowa \(42.3, -94.5\): the sea \(expected under 50 m\)/.test(text), "and those to look at");

  // Broken input stops, writing nothing
  const badOut = path.join(work, "bad");
  const odd = await run(["read", "--part", "0/1", "--out", badOut, "--source", source, "--only", "N45E007"]);
  ok(
    odd.status !== 0 &&
      /cannot be right/.test(odd.output) &&
      !fs.existsSync(path.join(badOut, "part-0.json")),
    "heights that cannot be right: stops",
  );
  const wrong = await run([
    "read",
    "--part",
    "0/1",
    "--out",
    badOut,
    "--source",
    source,
    "--only",
    "N44E007",
  ]);
  ok(wrong.status !== 0 && /not its 1° tile/.test(wrong.output), "a tile in the wrong place: stops");
  const few = await run(["pack", parts, "--out", path.join(work, "few")]);
  ok(
    few.status !== 0 && /only 3 DEM tiles/.test(few.output) && !fs.existsSync(path.join(work, "few")),
    "too few tiles for the world: stops",
  );

  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
