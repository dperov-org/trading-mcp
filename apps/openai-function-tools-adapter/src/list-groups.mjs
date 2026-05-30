import { availableGroups, availableNamespaces, groupCounts } from './lib/filter-registry.mjs';

const counts = groupCounts();

console.log('Top-level groups:');
for (const group of availableGroups()) {
  console.log(`- ${group}: ${counts[group]} tool(s)`);
}

console.log('');
console.log('Namespaces:');
for (const namespace of availableNamespaces()) {
  console.log(`- ${namespace}`);
}
