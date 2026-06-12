import fetch from 'node-fetch'; // wait, node 18 has global fetch! So we can use global fetch.
async function main() {
  const loginUrl = 'https://recy-connect-backend.vercel.app/api/auth/login';
  const dashboardUrl = 'https://recy-connect-backend.vercel.app/api/admin/dashboard';
  
  console.log("Logging in...");
  const loginResponse = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'panel.quantix@gmail.com',
      password: 'Qx$9mP#kL2vR@nT7wZ!4'
    })
  });
  
  const loginJson = await loginResponse.json();
  console.log("Login Status:", loginResponse.status);
  
  const token = loginJson.data?.accessToken || loginJson.accessToken;
  if (!token) {
    console.error("Login failed, no token:", loginJson);
    return;
  }
  
  console.log("Fetching dashboard...");
  const dbResponse = await fetch(dashboardUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const dbJson = await dbResponse.json();
  console.log("Dashboard Status:", dbResponse.status);
  console.log("Dashboard Data:", JSON.stringify(dbJson, null, 2));
}

main().catch(console.error);
