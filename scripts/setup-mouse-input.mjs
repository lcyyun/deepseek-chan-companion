import mouseInput from '../desktop/mouse-input.cjs';

const result = await mouseInput.ensureMouseInput({ force: process.argv.includes('--force') });
console.log(result.compiled ? 'Windows mouse-button observer compiled.' : 'Windows mouse-button observer is up to date.');
