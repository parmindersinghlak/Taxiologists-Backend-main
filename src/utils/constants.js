const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  DRIVER: "driver",
};

const DRIVER_STATUS = {
  FREE: "free",
  ON_RIDE: "on_ride",
  DROPPED: "dropped", // historical, won’t be set directly in v1
};

module.exports = { ROLES, DRIVER_STATUS };
