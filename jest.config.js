export default {
    testEnvironment: 'node',
    transform: {},
    moduleFileExtensions: ['js', 'mjs'],
    testMatch: ['**/tests/**/*.test.js'],
    setupFiles: ['dotenv/config'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    collectCoverageFrom: [
        'src/controllers/**/*.js',
        '!src/controllers/paymentController.js',
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 30000,
    maxWorkers: 1,
    forceExit: true,
    detectOpenHandles: true,
    transformIgnorePatterns: ['node_modules/(?!(uid)/)'],
};
