import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5000';

async function testOCREndpoint() {
    console.log('🧪 Testing OCR Endpoint\n');

    // Check if server is running
    try {
        const healthCheck = await fetch(`${BASE_URL}/api-docs`);
        if (!healthCheck.ok) {
            console.log('❌ Server is not running. Please start the server first.');
            return;
        }
        console.log('✅ Server is running\n');
    } catch (error) {
        console.log('❌ Cannot connect to server. Please start the server first.');
        return;
    }

    // Test analyze-document endpoint
    console.log('📄 Testing /api/auth/analyze-document endpoint...\n');

    // Create a simple test - we'll just test the endpoint exists
    const formData = new FormData();

    // Create a dummy text file to test (since we don't have a real CNIC image)
    const testContent = 'Test document content';
    const testFilePath = path.join(process.cwd(), 'tmp', 'test-doc.txt');

    // Ensure tmp directory exists
    if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
        fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
    }

    fs.writeFileSync(testFilePath, testContent);
    formData.append('document', fs.createReadStream(testFilePath));

    try {
        const response = await fetch(`${BASE_URL}/api/auth/analyze-document`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
        });

        const result = await response.json();

        if (response.ok) {
            console.log('✅ OCR endpoint is accessible');
            console.log('📊 Response structure:');
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('⚠️  OCR endpoint returned an error:');
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (error) {
        console.log('❌ Error testing OCR endpoint:', error.message);
    } finally {
        // Cleanup
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    }

    console.log('\n✅ Test completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Frontend should call /api/auth/analyze-document before registration');
    console.log('2. Show extracted CNIC/NTN to user for verification');
    console.log('3. After email verification, users can login immediately (auto-approved)');
}

testOCREndpoint();
