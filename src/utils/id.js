function genRideId() {
  // e.g., RIDE-20250828-6N6J1Z
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RIDE-${date}-${rand}`;
}
module.exports = { genRideId };
