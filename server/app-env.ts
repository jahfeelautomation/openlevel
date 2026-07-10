/**
 * Hono per-request variables shared across middleware and routes.
 * `operatorAuth` sets operatorId; `locationAccess` sets locationId after it has
 * verified the operator may touch that location. Routes read both from context.
 */
export interface AppEnv {
  Variables: {
    operatorId: string
    locationId: string
  }
}
