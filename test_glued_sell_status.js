// Regression: Sabre-style rows where the route is glued to a `*` marker and the
// sell-status column ("BOGMIA*SS1", "MIABCN*SS1") used to drop the whole leg,
// printing `SS 1` rows with `???` airports and blocking link generation.
const E = require("./spicy_engine.js");
const text = [
  "1 AA6892I 15APR Q LHRJFK SS1  1230P  320P /DCAA /E",
  "OPERATED BY BRITISH AIRWAYS",
  " 2 AA 913I 16APR F MIABOG SS1  1018A  105P /DCAA /E",
  " 3 AA1130O 16MAY S BOGMIA*SS1   630A 1138A /DCAA /E",
  " 4 AA 112O 16MAY S MIABCN*SS1   750P 1055A  17MAY M /DCAA /E",
].join("\n");
const [segs] = E.parse(text);
const out = E.renderItinerary(segs);
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } }
check("four legs parsed", segs.length === 4);
check("no ??? placeholders", !out.includes("???"));
check("leg 3 is AA 1130 BOG->MIA", segs[2] && segs[2].airline === "AA" && segs[2].flight_no === "1130" && segs[2].orig === "BOG" && segs[2].dest === "MIA");
check("leg 3 times 630A 1138A", segs[2] && segs[2].dep_time === "630A" && segs[2].arr_time === "1138A");
check("leg 4 is AA 112 MIA->BCN", segs[3] && segs[3].airline === "AA" && segs[3].flight_no === "112" && segs[3].orig === "MIA" && segs[3].dest === "BCN");
check("leg 4 overnight to 17MAY", segs[3] && segs[3].arr_day_shift === 1);
console.log(`${pass}/${pass + fail} checks`);
process.exit(fail ? 1 : 0);
