// DEV BYPASS — remove before production
const DEV_USER = {
  id: 'ebfae784-4886-4e9b-84a6-e6ad0227746e',
  email: 'narasimham@mutinytalent.com',
}

export async function requireUser() {
  return DEV_USER
}
