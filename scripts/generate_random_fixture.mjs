import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const seed = 260904;
let state = seed >>> 0;
const rand = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};
const pick = (items) => items[Math.floor(rand() * items.length)];

const input = await FileBlob.load("data/samples/demo-delivery-40-orders.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const ordersSheet = workbook.worksheets.getItem("orders");
const packagesSheet = workbook.worksheets.getItem("packages");

const zoneData = {
  Z1: {
    city: "新北市",
    districts: ["板橋", "新莊", "三重"],
    points: [[25.0114, 121.4618], [25.0358, 121.45], [25.0615, 121.4881]],
  },
  Z2: {
    cityChoices: ["新北市", "臺北市"],
    districts: ["中和", "永和", "新店", "文山"],
    points: [[24.999, 121.498], [25.0092, 121.5153], [24.9676, 121.5415], [24.9895, 121.57]],
  },
  Z3: {
    city: "臺北市",
    districts: ["萬華", "中正", "大同", "中山"],
    points: [[25.033, 121.499], [25.0324, 121.5199], [25.0634, 121.513], [25.052, 121.5331]],
  },
  Z4: {
    city: "臺北市",
    districts: ["大安", "信義", "松山", "南港"],
    points: [[25.0268, 121.5434], [25.033, 121.5654], [25.05, 121.5575], [25.0548, 121.6067]],
  },
  Z5: {
    city: "臺北市",
    districts: ["士林", "北投", "內湖"],
    points: [[25.095, 121.525], [25.132, 121.501], [25.083, 121.59]],
  },
};
const zones = Object.keys(zoneData);
const orderRows = [[
  "order_id", "zone_code", "city", "district", "location_label", "latitude", "longitude",
  "time_slot", "declared_package_count", "priority", "note",
]];
const packageRows = [["package_id", "order_id", "weight_kg"]];

for (let index = 1; index <= 40; index += 1) {
  const orderId = `RND-${seed}-${String(index).padStart(3, "0")}`;
  const zone = pick(zones);
  const definition = zoneData[zone];
  const districtIndex = Math.floor(rand() * definition.districts.length);
  const district = definition.districts[districtIndex];
  const city = definition.city ?? pick(definition.cityChoices);
  const base = definition.points[districtIndex % definition.points.length];
  const latitude = Number((base[0] + (rand() - 0.5) * 0.006).toFixed(6));
  const longitude = Number((base[1] + (rand() - 0.5) * 0.008).toFixed(6));
  const packageCount = 1 + Math.floor(rand() * 3);
  const timeSlot = rand() < 0.5 ? "AM" : "PM";
  const priority = rand() < 0.2 ? "HIGH" : "NORMAL";
  const serviceSeconds = 180;
  orderRows.push([
    orderId, zone, city, district, `隨機配送點 ${zone}-${String(index).padStart(2, "0")}`,
    latitude, longitude, timeSlot, packageCount, priority,
    `seed=${seed}; service_time_s=${serviceSeconds}; synthetic fixture`,
  ]);
  for (let packageIndex = 1; packageIndex <= packageCount; packageIndex += 1) {
    const packageId = `RPK-${seed}-${String(index).padStart(3, "0")}-${packageIndex}`;
    const weight = Number((1.5 + rand() * 5.5).toFixed(1));
    packageRows.push([packageId, orderId, weight]);
  }
}

ordersSheet.getRange("A1:K41").values = orderRows;
packagesSheet.getRange("A1:C121").clear({ applyTo: "contents" });
packagesSheet.getRange(`A1:C${packageRows.length}`).values = packageRows;
ordersSheet.freezePanes.freezeRows(1);
packagesSheet.freezePanes.freezeRows(1);

const outputPath = "data/samples/random-dispatch-seed-260904.xlsx";
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const python = process.env.PYTHON || (process.platform === "win32" ? "py" : "python3");
const normalized = spawnSync(python, ["scripts/normalize_xlsx.py", outputPath], { stdio: "inherit" });
if (normalized.status !== 0) throw new Error("XLSX_NORMALIZATION_FAILED");
const check = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 3000,
  tableMaxRows: 2,
  tableMaxCols: 12,
});
console.log(check.ndjson);
console.log(`created=${outputPath} seed=${seed} orders=${orderRows.length - 1} packages=${packageRows.length - 1}`);
