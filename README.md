# D&D Crafting Web App

We’re building a crafting system for a Dungeons & Dragons campaign. It allows players to combine ingredients and create potions, poisons, or alchemical items depending on the discipline they choose. The logic is based on the combination of three numeric properties per ingredient.

## 🌿 What This App Does

1. Load ingredient, recipe, and inventory data from JSON files.
2. Let users select 3 unique ingredients from their shared inventory.
3. Let users select a discipline (Herbalism, Alchemy, or Poison).
4. Combine the 3 ingredients using their 3 properties: Potency, Resonance, and Entropy.
5. Apply a tie-breaking rule depending on the chosen discipline.
6. Use the dominant attribute to determine the resulting recipe.
7. Show the crafted item’s name, category, and effect.
8. Optionally deduct ingredients from the inventory.
9. Allow the DM to edit ingredient and recipe data or grant ingredients.

## 🔢 Ingredient System

Each ingredient has:

- A `name`
- A value from 0 to 5 for each of:
  - Potency
  - Resonance
  - Entropy
- A `rarity`: Common, Uncommon, or Rare
- A `source` (biome or monster)

Example:

```json
{
  "name": "Sunleaf",
  "potency": 2,
  "resonance": 1,
  "entropy": 0,
  "rarity": "Uncommon",
  "source": "Forest"
}
```

## 📊 Recipe System

Each crafting discipline has its own recipe list of 45 items, stored as JSON:

- `recipes_herbalism.json`
- `recipes_alchemy.json`
- `recipes_poison.json`

Each list is divided into 3 subcategories of 15 recipes:

- Potency-dominant recipes: indices 0–14
- Resonance-dominant recipes: indices 15–29
- Entropy-dominant recipes: indices 30–44

Each recipe has:

```json
{
  "id": 15,
  "name": "Potion of Healing*",
  "category": "Herbalism",
  "qualityCategory": "Potency",
  "rarity": "Common",
  "effect": "Restores 2d4+2 hit points."
}
```

## 🧠 Crafting Logic

1. Select 3 unique ingredients.
2. Add their properties:
   - `total.potency = sum of potency values`
   - `total.resonance = sum of resonance values`
   - `total.entropy = sum of entropy values`
3. Determine the highest attribute.
   - If there’s a tie for the highest, use the discipline’s tie-breaker matrix.

### 🧭 Tie-breaker Priority

| Discipline | Highest Priority → Lowest |
|------------|---------------------------|
| Herbalism  | Resonance > Entropy > Potency |
| Alchemy    | Potency > Resonance > Entropy |
| Poison     | Entropy > Potency > Resonance |

4. Use the dominant attribute to choose a recipe subgroup:
   - Potency → first 15 items (index 0–14)
   - Resonance → second 15 items (index 15–29)
   - Entropy → third 15 items (index 30–44)
5. Return the item at that index (deterministic or random within that block).

## 📁 File Overview

- `public/data/ingredients.json` — All ingredients
- `public/data/recipes_herbalism.json` — Herbalism recipes
- `public/data/recipes_alchemy.json` — Alchemy recipes
- `public/data/recipes_poison.json` — Poison recipes
- `public/data/inventory.json` — Player party’s shared inventory

## 🔗 Reference Sheet

All original ingredient and recipe data comes from this Google Sheet:

https://docs.google.com/spreadsheets/d/1x6BFfhpAMj8qg38JATsB0Ck8ntvK7wjrWwa87WGLcTw

## ✅ Tasks for Copilot

You can ask Copilot Chat to help with:

- Building a component to select 3 ingredients from inventory
- Displaying their combined stats
- Implementing the `calculateResult()` logic using the tie-breaker
- Loading recipe data and showing the result
- Building an inventory viewer
- Creating a DM-only editor for ingredients and inventory

The web app will be hosted in GitHub.

## ▶️ Run Locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173/`).

## 🚀 Deploy to GitHub Pages

```bash
npm run deploy
```

This builds the app and publishes the `dist/` folder to the `gh-pages` branch.
