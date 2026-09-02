// Type stubs para dependencias opcionales (firebase-admin, @parse/node-apn).
// Estos se instalan solo en producción.

declare module "firebase-admin" {
  const admin: unknown;
  export default admin;
}

declare module "@parse/node-apn" {
  const apn: unknown;
  export default apn;
}
