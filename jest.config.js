export default {
    testEnvironment: 'node',
    transform: {},
    moduleFileExtensions: ['js', 'mjs'],
    testMatch: ['**/tests/**/*.test.js'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    collectCoverageFrom: [
        'src/controllers/**/*.js',
        '!src/controllers/paymentController.js',
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 30000,
    forceExit: true,
    detectOpenHandles: true,
};
