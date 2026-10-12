#!/usr/bin/env node
/* verify_price_gate.js — the live gate check for the PRICE block.
 *
 * Loads the real seatmap_price.js in Node with a tiny XHR shim that talks to
 * a real HTTP endpoint, drives attach() exactly the way the /seatmap page
 * does, and asserts the price block:
 *
 *   - appears only while the fare service answers the health probe,
 *   - stays away (and unwired) when the service is gone,
 *   - hides itself again when a live click comes back with no_fare,
 *   - never renders a "not connected" string anywhere.
 *
 * Usage:
 *   node verify_price_gate.js http://127.0.0.1:8787/api/flights/price
 *
 * Pass the same endpoint value the page was built with (a relative
 * "/api/flights/price" also works when a proxy sits in front).
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const SOURCE = fs.readFileSync(path.join(__dirname, "seatmap_price.js"), "utf8");

let checks = 0;
let fails = 0;
function test(name, fn) {
  try {
    fn();
    checks++;
    console.log("  PASS  " + name);
  } catch (error) {
    fails++;
    console.error("  FAIL  " + name);
    console.error("    " + (error && error.message));
  }
}

/* A minimal real XHR: enough of the browser surface for this module. */
function makeXhr() {
  const xhr = {
    readyState: 0,
    responseText: "",
    status: 0,
    timeout: 0,
    _onreadystatechange: null,
    _onerror: null,
    _ontimeout: null,
    open(method, url) {
      this._method = method;
      this._url = url;
    },
    send() {
      let target;
      try {
        target = new URL(this._url, "http://127.0.0.1");
      } catch (error) {
        if (this._onerror) this._onerror();
        return;
      }
      const req = http.request(
        { hostname: target.hostname, port: target.port || 80, path: target.pathname + target.search, method: this._method || "GET" },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            this.readyState = 4;
            this.status = res.statusCode;
            this.responseText = body;
            if (this._onreadystatechange) this._onreadystatechange();
          });
        }
      );
      req.on("error", () => { if (this._onerror) this._onerror(); });
      req.end();
    },
    abort() {}
  };
  Object.defineProperty(xhr, "onreadystatechange", {
    set(fn) { this._onreadystatechange = fn; },
    get() { return this._onreadystatechange; }
  });
  Object.defineProperty(xhr, "onerror", {
    set(fn) { this._onerror = fn; },
    get() { return this._onerror; }
  });
  Object.defineProperty(xhr, "ontimeout", {
    set(fn) { this._ontimeout = fn; },
    get() { return this._ontimeout; }
  });
  return xhr;
}

/* Load a fresh copy of the module with the browser globals it expects. */
function loadPrice(endpoint, doc) {
  const modulePath = path.join(__dirname, "seatmap_price.js");
  delete require.cache[modulePath];
  global.window = {
    document: doc,
    location: { pathname: "/seatmap", search: "" },
    SPICY_PRICE_ENDPOINT: endpoint
  };
  global.SPICY_PRICE_ENDPOINT = endpoint;
  global.document = doc;
  global.location = global.window.location;
  global.XMLHttpRequest = makeXhr;
  return require(modulePath);
}

/* A fake DOM: only the nodes the PRICE module touches. */
function makeDoc() {
  const state = {};
  function node(id) {
    return {
      id: id,
      innerHTML: "",
      style: { display: "" },
      disabled: false,
      addEventListener: function (event, fn) { this._handlers = this._handlers || {}; this._handlers[event] = fn; }
    };
  }
  ["seatmapPriceBlock", "seatmapPriceButton", "seatmapPriceResult", "seatmapPriceNote"].forEach(function (id) {
    state[id] = node(id);
  });
  /* Mirror the built template: the block ships hidden until the probe
     proves the service is answering. */
  state.seatmapPriceBlock.style.display = "none";
  state.getElementById = function (id) { return state[id] || null; };
  return state;
}

function waitFor(fn, timeoutMs) {
  return new Promise(function (resolve) {
    const started = Date.now();
    (function poll() {
      let result = false;
      try { result = fn(); } catch (error) { result = false; }
      if (result) return resolve(true);
      if (Date.now() - started > (timeoutMs || 6000)) return resolve(false);
      setTimeout(poll, 50);
    })();
  });
}

const endpoint = process.argv[2];
if (!endpoint) {
  console.error("usage: node verify_price_gate.js <endpoint-or-path>");
  process.exit(2);
}

/* The page builds the absolute request URL from this, so a bare path needs a
   host to reach during this check; the browser uses its own origin. */
const target = /^https?:\/\//.test(endpoint) ? endpoint : "http://127.0.0.1:8787" + endpoint;

function report() {
  console.log("");
  console.log("================================================================");
  console.log("RESULT: " + checks + " passed, " + fails + " failed");
  console.log("================================================================");
  process.exit(fails ? 1 : 0);
}

async function main() {
  console.log("PRICE gate verification against " + target);
  console.log("");

  const doc = makeDoc();
  const Price = loadPrice(target, doc);

  test("1.01  the module exports the gate API", function () {
    ["attach", "hidePriceBlock", "showPriceBlock", "checkHealth"].forEach(function (k) {
      assert.strictEqual(typeof Price[k], "function", "missing " + k);
    });
  });

  test("1.02  the block starts hidden before anything is probed", function () {
    assert.strictEqual(doc.seatmapPriceBlock.style.display, "none");
  });

  /* Probe the real service, then drive attach() the way the page does. */
  const healthXhr = makeXhr();
  const healthy = await new Promise(function (resolve) {
    healthXhr.open("GET", target.replace(/\/api\/flights\/price$/, "/healthz"), true);
    healthXhr.onreadystatechange = function () {
      if (healthXhr.readyState === 4) resolve(healthXhr.status === 200);
    };
    healthXhr.onerror = function () { resolve(false); };
    healthXhr.send();
  });

  console.log("  (health probe said: " + (healthy ? "service up" : "service down") + ")");
  console.log("");

  const state = {
    legs: [{ airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" }],
    legIndex: 0
  };

  Price.attach(doc, state);
  const settled = await waitFor(function () {
    return healthy
      ? doc.seatmapPriceBlock.style.display === ""
      : doc.seatmapPriceBlock.style.display === "none";
  });
  if (!settled) {
    console.error("  FAIL  attach() did not settle the block visibility in time");
    process.exit(1);
  }

  test(healthy
    ? "2.01  with the service answering, the block is shown and the button is wired"
    : "2.01  with the service down, the block stays hidden and no handler is wired", function () {
    if (healthy) {
      assert.strictEqual(doc.seatmapPriceBlock.style.display, "");
      assert.ok(doc.seatmapPriceButton._handlers && doc.seatmapPriceButton._handlers.click,
        "the PRICE button has no click handler");
    } else {
      assert.strictEqual(doc.seatmapPriceBlock.style.display, "none");
      assert.ok(!(doc.seatmapPriceButton._handlers && doc.seatmapPriceButton._handlers.click),
        "the PRICE button was wired while the service was down");
    }
  });

  if (healthy) {
    /* A click that comes back no_fare must put the whole block away again —
       never a visible half-quote. */
    doc.seatmapPriceButton._handlers.click();
    const gone = await waitFor(function () {
      return doc.seatmapPriceBlock.style.display === "none";
    });
    test("2.02  a live click that returns no_fare hides the block by itself", function () {
      assert.ok(gone, "the block stayed on screen after a no_fare reply");
      assert.strictEqual(doc.seatmapPriceResult.innerHTML, "", "stale panel text survived the hide");
    });
  }

  test(healthy
    ? "2.03  hidePriceBlock() re-hides everything and clears the panel"
    : "2.02  hidePriceBlock() re-hides everything and clears the panel", function () {
    Price.hidePriceBlock();
    assert.strictEqual(doc.seatmapPriceBlock.style.display, "none");
    assert.strictEqual(doc.seatmapPriceButton.style.display, "none");
    assert.strictEqual(doc.seatmapPriceResult.style.display, "none");
    assert.strictEqual(doc.seatmapPriceNote.style.display, "none");
    assert.strictEqual(doc.seatmapPriceResult.innerHTML, "");
  });

  test(healthy
    ? "2.04  the block never renders the words 'not connected'"
    : "2.03  the block never renders the words 'not connected'", function () {
    assert.ok(doc.seatmapPriceResult.innerHTML.toLowerCase().indexOf("not connected") < 0,
      "a not-connected string reached the page");
  });

  report();
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
