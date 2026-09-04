import assert from "node:assert/strict";
import { isAccepted, isArtistAccepted } from "../app/scoring.ts";

assert.equal(isArtistAccepted("Визбор", ["L'ONE feat. Варвара Визбор", "L'ONE", "Варвара Визбор"], "Исполнитель + исполнительница"), true);
assert.equal(isArtistAccepted("Пугачёва", ["Алла Пугачёва"], "Исполнительница"), true);
assert.equal(isArtistAccepted("Корж", ["Макс Корж", "Максим Корж"], "Исполнитель"), true);
assert.equal(isArtistAccepted("Шут", ["Король и Шут"], "Группа"), false);
assert.equal(isAccepted("Якутяночка", ["Якутяночка ft. Варвара Визбор"]), true);

console.log("scoring tests passed");
