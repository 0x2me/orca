export type RuntimeAccessGrant = {
  deviceId: string
  name: string
  createdAt: number
  lastSeenAt: number | null
  // Signed in with the link but never swapped it for its own credential (an older Orca).
  olderPairingMethod?: true
}
