module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/source', '<rootDir>/test'],
    moduleNameMapper: {
        '^~data$': '<rootDir>/source/data/index.ts',
        '^~common/(.*)$': '<rootDir>/source/common/$1',
        '^~contentscript/(.*)$': '<rootDir>/source/contentscript/$1',
        '^~data/(.*)$': '<rootDir>/source/data/$1',
        '^~popup/(.*)$': '<rootDir>/source/popup/$1',
    },
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    collectCoverageFrom: [
        'source/contentscript/controller.ts',
        'source/data/*.ts',
        'source/popup/components/Popup/index.tsx',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    coverageThreshold: {
        global: {
            branches: 85,
            functions: 85,
            lines: 85,
            statements: 85,
        },
    },
};
