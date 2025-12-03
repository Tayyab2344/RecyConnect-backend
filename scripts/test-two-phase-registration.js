/**
 * Test Script for Two-Phase Registration
 * 
 * This script tests the new registration flow where users are NOT created
 * until OTP is verified.
 */

const baseURL = 'http://localhost:5000/api/auth';

// Test 1: Register without verifying OTP, then try again
async function testRegistrationRetry() {
    console.log('\n=== Test 1: Registration Retry Without OTP ===');

    const testEmail = `test${Date.now()}@example.com`;
    const registrationData = {
        email: testEmail,
        password: 'Test123!@#',
        name: 'Test User',
        role: 'INDIVIDUAL',
        address: '123 Test Street',
        contactNo: '+923001234567'
    };

    try {
        // First registration attempt
        console.log('1. First registration attempt...');
        const res1 = await fetch(`${baseURL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registrationData)
        });
        const data1 = await res1.json();
        console.log('Response:', data1);

        // Don't verify OTP, try to register again
        console.log('\n2. Second registration attempt (without verifying OTP)...');
        const res2 = await fetch(`${baseURL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registrationData)
        });
        const data2 = await res2.json();
        console.log('Response:', data2);

        if (data2.success) {
            console.log('✅ PASS: Can re-register without OTP verification');
        } else {
            console.log('❌ FAIL: Cannot re-register');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Test 2: Complete registration flow
async function testCompleteFlow() {
    console.log('\n=== Test 2: Complete Registration Flow ===');

    const testEmail = `complete${Date.now()}@example.com`;
    const registrationData = {
        email: testEmail,
        password: 'Test123!@#',
        name: 'Complete Test',
        role: 'INDIVIDUAL',
        address: '456 Test Avenue',
        contactNo: '+923009876543'
    };

    try {
        // Register
        console.log('1. Registering...');
        const res1 = await fetch(`${baseURL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registrationData)
        });
        const data1 = await res1.json();
        console.log('Response:', data1);

        // Note: In real scenario, user would get OTP via email
        // For testing, you'll need to check the console for the OTP
        console.log('\n⚠️  Check your backend console for the OTP');
        console.log('Then run verifyOtp with the OTP');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Test 3: Resend OTP for pending registration
async function testResendOtp(email) {
    console.log('\n=== Test 3: Resend OTP ===');

    try {
        const res = await fetch(`${baseURL}/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        console.log('Response:', data);

        if (data.success) {
            console.log('✅ PASS: OTP resent successfully');
        } else {
            console.log('❌ FAIL: Could not resend OTP');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run tests
async function runAllTests() {
    console.log('🚀 Starting Two-Phase Registration Tests\n');
    console.log('Make sure backend server is running on http://localhost:5000\n');

    await testRegistrationRetry();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

    await testCompleteFlow();

    console.log('\n\n✅ All automated tests completed!');
    console.log('\n📝 Manual Testing Steps:');
    console.log('1. Use Postman/Thunder Client to register a user');
    console.log('2. Check console for OTP');
    console.log('3. Verify OTP using /api/auth/verify-otp');
    console.log('4. Check database - user should ONLY exist after OTP verification');
}

// Check if this is run directly or imported
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    runAllTests().catch(console.error);
}

export { testRegistrationRetry, testCompleteFlow, testResendOtp };
