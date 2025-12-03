import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000/api';

async function testLogin() {
    console.log('🧪 Testing Login Endpoint\n');

    // Test with both warehouse accounts
    const accounts = [
        { email: 'ranatayyab941@gmail.com', label: 'Latest Warehouse' },
        { email: 'tayyabatiq300@gmail.com', label: 'Older Warehouse' }
    ];

    for (const account of accounts) {
        console.log(`\n📧 Testing: ${account.label} (${account.email})`);
        console.log('⚠️  NOTE: I don\'t know your password, so this will likely fail.');
        console.log('   Please try logging in with the password you set during registration.\n');

        // Try with a dummy password (will fail, but shows the response structure)
        try {
            const response = await fetch(`${BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier: account.email,
                    password: 'TestPassword123!'
                })
            });

            const data = await response.json();

            console.log(`   Status: ${response.status}`);
            console.log(`   Response:`, JSON.stringify(data, null, 2));

            if (response.status === 401) {
                console.log('   ❌ Invalid credentials (expected - wrong password)');
            } else if (response.status === 200) {
                console.log('   ✅ Login successful!');
            }
        } catch (error) {
            console.log('   ❌ Error:', error.message);
        }
    }

    console.log('\n\n📋 INSTRUCTIONS:');
    console.log('1. Make sure you\'re using the correct email:');
    console.log('   - ranatayyab941@gmail.com (latest)');
    console.log('   - tayyabatiq300@gmail.com (older)');
    console.log('\n2. Use the EXACT password you entered during registration');
    console.log('\n3. If you forgot your password, use the "Forgot Password" feature');
    console.log('\n4. After fixing the Flutter code, do a HOT RELOAD (press "r" in the terminal)');
    console.log('   or restart the app completely');
}

testLogin();
