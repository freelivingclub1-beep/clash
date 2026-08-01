import AdmZip from 'adm-zip';
const SRC='/tmp/lpc/lpc-runtime-zips/zips';
// sheet_definitions describes every layer the generator knows about.
const zip = new AdmZip(`${SRC}/sheet_definitions.zip`);
const names = zip.getEntries().map(e=>e.entryName);
console.log('definition files:', names.length);
const canine = names.filter(n=>/dog|hound|wolf|canine|quadruped|beast|animal|mount|horse|cat\b/i.test(n));
console.log('canine/animal-ish:', canine.join('\n'));
