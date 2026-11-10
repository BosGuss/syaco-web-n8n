const fs = require('fs');

const files = [
  'workflows/flow1-solution-discovery.json',
  'workflows/flow2-content-publisher.json',
  'workflows/flow3-community-lead-assistant.json'
];

let hasError = false;

files.forEach(file => {
  console.log('=== Checking', file, '===');
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const names = new Set(wf.nodes.map(n => n.name));
  
  wf.nodes.forEach(n => {
    const str = JSON.stringify(n.parameters || {});
    const regex = /\$\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      const ref = match[1];
      if (!names.has(ref)) {
        console.error(`❌ In node "${n.name}": references "${ref}" which DOES NOT EXIST!`);
        hasError = true;
      } else {
        console.log(`✓ In node "${n.name}": references "${ref}"`);
      }
    }
  });
});

if (hasError) {
  console.error('\n❌ Found broken node references!');
  process.exit(1);
} else {
  console.log('\n✅ All node references are valid!');
}
