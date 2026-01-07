// Core crafting math for totals, tie-breaking, and recipe selection.

const PRIORITY_MATRIX = {
  Herbalism: ['resonance', 'entropy', 'potency'],
  Alchemy: ['potency', 'resonance', 'entropy'],
  Poison: ['entropy', 'potency', 'resonance']
};

const ATTRIBUTE_ORDER = ['potency', 'resonance', 'entropy'];

export function calculateTotals(ingredients = []) {
  return ingredients.reduce(
    (acc, ingredient) => {
      acc.potency += ingredient?.potency ?? 0;
      acc.resonance += ingredient?.resonance ?? 0;
      acc.entropy += ingredient?.entropy ?? 0;
      return acc;
    },
    { potency: 0, resonance: 0, entropy: 0 }
  );
}

export function resolveDominantAttribute(totals, discipline) {
  const entries = Object.entries(totals);
  const maxValue = Math.max(...entries.map(([, value]) => value));
  const tied = entries.filter(([, value]) => value === maxValue).map(([key]) => key);

  if (tied.length <= 1) {
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }

  const priority = PRIORITY_MATRIX[discipline] || ATTRIBUTE_ORDER;
  return priority.find((attr) => tied.includes(attr)) || tied[0];
}

function getTierIndex(attribute) {
  return ATTRIBUTE_ORDER.indexOf(attribute);
}

function deterministicRoll(attribute, totals) {
  const value = totals?.[attribute] ?? 0;
  const clamped = Math.min(15, Math.max(1, value));
  return clamped - 1;
}

export function selectRecipe(recipes = [], attribute, totals, mode = 'deterministic') {
  if (!recipes.length) {
    return { recipe: null, tierIndex: getTierIndex(attribute), roll: 0, idealIndex: 0, usedFallback: false };
  }

  const tierIndex = Math.max(0, getTierIndex(attribute));
  const roll = mode === 'random'
    ? Math.floor(Math.random() * 15)
    : deterministicRoll(attribute, totals);
  const idealIndex = tierIndex * 15 + roll;
  let recipe = null;
  let usedFallback = false;

  const qualityKey = (attribute || '').toLowerCase();
  const tierRecipes = recipes.filter(
    (item) => item?.qualityCategory?.toLowerCase() === qualityKey
  );

  if (tierRecipes.length) {
    recipe = tierRecipes[roll % tierRecipes.length] || null;
    usedFallback = tierRecipes.length < 15;
  } else {
    recipe = recipes[idealIndex] || null;
  }

  if (!recipe) {
    const qualityMatches = recipes.filter(
      (item) => item?.qualityCategory?.toLowerCase() === attribute
    );
    if (qualityMatches.length) {
      recipe = qualityMatches[roll % qualityMatches.length];
      usedFallback = true;
    } else if (recipes.length) {
      recipe = recipes[roll % recipes.length];
      usedFallback = true;
    }
  }

  return { recipe, tierIndex, roll, idealIndex, usedFallback };
}

export function calculateResult(ingredients, discipline, recipes, options = {}) {
  const totals = calculateTotals(ingredients);
  const dominantAttribute = resolveDominantAttribute(totals, discipline);
  const mode = options.mode || 'deterministic';
  const selection = selectRecipe(recipes, dominantAttribute, totals, mode);

  return {
    ...selection,
    totals,
    dominantAttribute,
    mode
  };
}
