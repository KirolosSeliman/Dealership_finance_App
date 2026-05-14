export function getPermissions(role?: string) {
  const owner = role === "owner";
  const admin = role === "admin";
  const member = role === "member";
  const accountant = role === "accountant";
  return {
    manageVehicles: owner || admin || member,
    deleteVehicles: owner || admin,
    manageExpenses: owner || admin || member,
    manageSales: owner || admin || member,
    manageAttachments: owner || admin || member,
    manageContacts: owner || admin || member,
    manageCash: owner || admin,
    manageBackups: owner || admin,
    exportBackups: owner || admin,
    manageReports: owner || admin || accountant,
    manageRoles: owner,
    manageSettings: owner,
    manageRecurringExpenses: owner || admin,
  };
}

export type Permissions = ReturnType<typeof getPermissions>;
