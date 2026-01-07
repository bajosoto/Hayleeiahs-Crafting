import React, { useEffect, useMemo, useState } from 'react';
import {
  calculateResult,
  calculateTotals,
  resolveDominantAttribute
} from '../utils/calculateResult';
import { supabase } from '../lib/supabaseClient';

const DISCIPLINES = ['Herbalism', 'Alchemy', 'Poison'];
const ATTRIBUTE_LABELS = {
  potency: 'Potency',
  resonance: 'Resonance',
  entropy: 'Entropy'
};
const TIE_RULES = {
  Herbalism: 'Resonance > Entropy > Potency',
  Alchemy: 'Potency > Resonance > Entropy',
  Poison: 'Entropy > Potency > Resonance'
};
const QUALITY_ORDER = { Potency: 0, Resonance: 1, Entropy: 2 };
const LOCAL_LOGIN_DOMAIN = 'bajosoto.local';

const getRarityClass = (rarity) => {
  const normalized = (rarity || '').toLowerCase();
  if (normalized.includes('uncommon')) return 'rarity-uncommon';
  if (normalized.includes('common')) return 'rarity-common';
  if (normalized.includes('legendary') || normalized.includes('rare')) return 'rarity-rare';
  return '';
};

const normalizeQuality = (value) => {
  const normalized = (value || '').trim();
  const lower = normalized.toLowerCase();
  if (lower === 'clarity') return 'Resonance';
  if (lower === 'chaos') return 'Entropy';
  if (lower === 'potency') return 'Potency';
  if (lower === 'resonance') return 'Resonance';
  if (lower === 'entropy') return 'Entropy';
  return normalized;
};

const qualityToAttribute = (quality) => {
  const normalized = normalizeQuality(quality);
  const lower = normalized.toLowerCase();
  if (ATTRIBUTE_LABELS[lower]) return lower;
  return 'potency';
};

const normalizeIngredientRow = (row) => ({
  name: (row.name || '').trim(),
  potency: Number(row.potency ?? 0),
  resonance: Number(row.resonance ?? 0),
  entropy: Number(row.entropy ?? 0),
  rarity: row.rarity || '',
  source: row.source || ''
});

const normalizeRecipeRow = (row, disciplineFallback = '') => {
  const discipline = row.discipline || row.category || disciplineFallback;
  const recipeNo = Number(row.recipe_no ?? row.recipeNo ?? row.id ?? 0);
  return {
    id: recipeNo || row.id || 0,
    recipeNo,
    name: row.name || '',
    category: row.category || discipline,
    qualityCategory: normalizeQuality(row.quality_category || row.qualityCategory || ''),
    rarity: row.rarity || '',
    effect: row.effect || '',
    description: row.description || '',
    source: row.source || '',
    discipline,
    discovered: Boolean(row.discovered)
  };
};

const sortRecipes = (list) => {
  return [...list].sort((a, b) => {
    const qa = QUALITY_ORDER[a.qualityCategory] ?? 99;
    const qb = QUALITY_ORDER[b.qualityCategory] ?? 99;
    if (qa !== qb) return qa - qb;
    return (a.recipeNo || 0) - (b.recipeNo || 0);
  });
};

const buildLoginEmail = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@${LOCAL_LOGIN_DOMAIN}`;
};

function IngredientSelector() {
  const hasSupabase = Boolean(supabase);

  const [ingredients, setIngredients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [recipes, setRecipes] = useState({ Herbalism: [], Alchemy: [], Poison: [] });
  const [selectedNames, setSelectedNames] = useState(['', '', '']);
  const [discipline, setDiscipline] = useState('Herbalism');
  const [result, setResult] = useState(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [grantName, setGrantName] = useState('');
  const [grantQuantity, setGrantQuantity] = useState(1);
  const [dmMessage, setDmMessage] = useState('');
  const [syncError, setSyncError] = useState('');

  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState('anonymous');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const canEditData = !hasSupabase || userRole === 'dm';
  const canWriteInventory = !hasSupabase || userRole === 'dm' || userRole === 'party';
  const showAuthOnly = hasSupabase && !session;

  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;

    const fetchRole = async (currentSession) => {
      if (!currentSession?.user?.id) {
        if (active) setUserRole('anonymous');
        return;
      }
      const { data, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', currentSession.user.id)
        .single();
      if (!active) return;
      if (roleError || !data?.role) {
        setUserRole('anonymous');
        return;
      }
      setUserRole(data.role);
    };

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session || null);
      await fetchRole(data.session);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      fetchRole(nextSession);
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, [hasSupabase]);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        setLoading(true);
        setLoadError('');
        setSyncError('');

        if (hasSupabase && !session) {
          setLoading(false);
          return;
        }

        if (hasSupabase) {
          const [ingredientResult, inventoryResult, recipesResult] = await Promise.all([
            supabase.from('ingredients').select('*').order('name', { ascending: true }),
            supabase.from('inventory').select('*').order('name', { ascending: true }),
            supabase.from('recipes').select('*')
          ]);

          if (ingredientResult.error || inventoryResult.error || recipesResult.error) {
            throw new Error('Supabase query failed');
          }

          const ingredientData = (ingredientResult.data || [])
            .map(normalizeIngredientRow)
            .filter((item) => item.name);
          const inventoryData = (inventoryResult.data || []).map((row) => ({
            name: row.name,
            quantity: Number(row.quantity ?? 0)
          }));
          const recipeRows = (recipesResult.data || []).map((row) => normalizeRecipeRow(row));

          const grouped = { Herbalism: [], Alchemy: [], Poison: [] };
          recipeRows.forEach((recipe) => {
            if (grouped[recipe.discipline]) {
              grouped[recipe.discipline].push(recipe);
            }
          });

          const sortedRecipes = {
            Herbalism: sortRecipes(grouped.Herbalism),
            Alchemy: sortRecipes(grouped.Alchemy),
            Poison: sortRecipes(grouped.Poison)
          };

          if (!active) return;
          setIngredients(ingredientData);
          setInventory(inventoryData);
          setRecipes(sortedRecipes);

          const sortedInventory = [...inventoryData].sort((a, b) => a.name.localeCompare(b.name));
          const initialSelection = sortedInventory
            .filter((item) => item.quantity > 0)
            .slice(0, 3)
            .map((item) => item.name);
          setSelectedNames([
            initialSelection[0] || '',
            initialSelection[1] || '',
            initialSelection[2] || ''
          ]);

          const sortedIngredients = [...ingredientData].sort((a, b) => a.name.localeCompare(b.name));
          setGrantName(sortedIngredients[0]?.name || '');
        } else {
          const baseUrl = import.meta.env.BASE_URL || '/';
          const [ingredientData, inventoryData, herb, alchemy, poison] = await Promise.all([
            fetch(`${baseUrl}data/ingredients.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/inventory.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_herbalism.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_alchemy.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_poison.json`).then((res) => res.json())
          ]);

          if (!active) return;

          const ingredientRows = ingredientData.map(normalizeIngredientRow);
          const herbRecipes = sortRecipes(herb.map((row) => normalizeRecipeRow(row, 'Herbalism')));
          const alchemyRecipes = sortRecipes(
            alchemy.map((row) => normalizeRecipeRow(row, 'Alchemy'))
          );
          const poisonRecipes = sortRecipes(poison.map((row) => normalizeRecipeRow(row, 'Poison')));

          setIngredients(ingredientRows);
          setInventory(inventoryData);
          setRecipes({
            Herbalism: herbRecipes,
            Alchemy: alchemyRecipes,
            Poison: poisonRecipes
          });

          const sortedInventory = [...inventoryData].sort((a, b) => a.name.localeCompare(b.name));
          const initialSelection = sortedInventory
            .filter((item) => item.quantity > 0)
            .slice(0, 3)
            .map((item) => item.name);
          setSelectedNames([
            initialSelection[0] || '',
            initialSelection[1] || '',
            initialSelection[2] || ''
          ]);

          const sortedIngredients = [...ingredientRows].sort((a, b) => a.name.localeCompare(b.name));
          setGrantName(sortedIngredients[0]?.name || '');
        }

        setLoadError('');
      } catch (err) {
        if (!active) return;
        setLoadError(
          hasSupabase
            ? 'Failed to load data from Supabase. Check your tables and policies.'
            : 'Failed to load data. Check the JSON files in public/data.'
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, [hasSupabase, session]);

  const inventoryMap = useMemo(() => {
    const map = new Map();
    inventory.forEach((item) => map.set(item.name, item.quantity));
    return map;
  }, [inventory]);

  const ingredientMap = useMemo(() => {
    return new Map(ingredients.map((item) => [item.name, item]));
  }, [ingredients]);

  const sortedIngredients = useMemo(() => {
    return [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients]);

  const selectedIngredients = useMemo(() => {
    return selectedNames.map((name) => ingredientMap.get(name)).filter(Boolean);
  }, [selectedNames, ingredientMap]);

  const totals = useMemo(() => calculateTotals(selectedIngredients), [selectedIngredients]);
  const dominantAttribute = useMemo(() => {
    if (selectedIngredients.length !== 3) return null;
    return resolveDominantAttribute(totals, discipline);
  }, [totals, discipline, selectedIngredients.length]);

  const isTie = useMemo(() => {
    if (selectedIngredients.length !== 3) return false;
    const values = Object.values(totals);
    const maxValue = Math.max(...values);
    return values.filter((value) => value === maxValue).length > 1;
  }, [totals, selectedIngredients.length]);

  const inventoryRows = useMemo(() => {
    return ingredients
      .map((ingredient) => ({
        ...ingredient,
        quantity: inventoryMap.get(ingredient.name) ?? 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, inventoryMap]);

  const inventoryDisplayRows = useMemo(() => {
    return inventoryRows.filter((ingredient) => ingredient.quantity > 0);
  }, [inventoryRows]);

  const almanacEntries = useMemo(() => {
    const groups = { Potency: {}, Resonance: {}, Entropy: {} };
    const list = recipes[discipline] || [];
    list.forEach((recipe) => {
      const quality = normalizeQuality(recipe.qualityCategory);
      const slot = Number(recipe.recipeNo || recipe.id || 0);
      if (!groups[quality] || !slot) return;
      groups[quality][slot] = recipe;
    });
    return groups;
  }, [recipes, discipline]);

  const hasValidSelection = useMemo(() => {
    return selectedNames.every(Boolean) && new Set(selectedNames).size === 3;
  }, [selectedNames]);

  const expectedResult = useMemo(() => {
    if (!hasValidSelection) return null;
    const recipeList = recipes[discipline] || [];
    if (!recipeList.length) return null;
    return calculateResult(selectedIngredients, discipline, recipeList);
  }, [hasValidSelection, selectedIngredients, discipline, recipes]);

  const resultIsKnown = Boolean(
    result?.recipe && (result.wasDiscovered || result.recipe.discovered)
  );
  const expectedRecipe = expectedResult?.recipe || null;
  const expectedIsKnown = Boolean(expectedRecipe?.discovered);
  const expectedLabel = expectedRecipe
    ? expectedIsKnown
      ? expectedRecipe.name
      : '???'
    : 'Select ingredients';
  const expectedBadgeClass = expectedRecipe ? getRarityClass(expectedRecipe.rarity) : 'expected-empty';

  useEffect(() => {
    if (!resultModalOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setResultModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resultModalOpen]);

  const handleSelectChange = (index, value) => {
    setSelectedNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setError('');
  };

  const openResultModal = (nextResult) => {
    setResult(nextResult);
    setResultModalOpen(true);
  };

  const handleAlmanacSelect = (recipe) => {
    if (!recipe || !recipe.discovered) return;
    const quality = normalizeQuality(recipe.qualityCategory);
    const dominantAttr = qualityToAttribute(quality);
    const slot = Number(recipe.recipeNo || recipe.id || 1);
    const roll = Math.max(0, Math.min(14, slot - 1));
    const tierIndex = QUALITY_ORDER[quality] ?? 0;
    openResultModal({
      recipe,
      dominantAttribute: dominantAttr,
      tierIndex,
      roll,
      totals: null,
      usedFallback: false,
      mode: 'deterministic',
      wasDiscovered: true
    });
  };

  const persistInventory = async (updates) => {
    if (!hasSupabase) return true;
    if (!canWriteInventory) {
      setError('Sign in as DM or Party to update inventory.');
      return false;
    }
    setSyncError('');
    const { error: upsertError } = await supabase
      .from('inventory')
      .upsert(updates, { onConflict: 'name' });
    if (upsertError) {
      setSyncError('Failed to sync inventory updates.');
      return false;
    }
    return true;
  };

  const markRecipeDiscovered = async (recipe) => {
    if (!recipe) return;
    setRecipes((prev) => {
      const next = { ...prev };
      const list = prev[recipe.discipline] || [];
      next[recipe.discipline] = list.map((item) => {
        const sameSlot = item.recipeNo === recipe.recipeNo && item.qualityCategory === recipe.qualityCategory;
        const sameName = item.name === recipe.name;
        if (sameSlot && sameName) {
          return { ...item, discovered: true };
        }
        return item;
      });
      return next;
    });

    if (!hasSupabase) return;
    setSyncError('');
    const targetSlot = recipe.recipeNo || recipe.id || 0;
    const { error: updateError } = await supabase
      .from('recipes')
      .update({ discovered: true })
      .eq('discipline', recipe.discipline)
      .eq('recipe_no', targetSlot)
      .eq('quality_category', recipe.qualityCategory);
    if (updateError) {
      setSyncError('Failed to sync recipe discovery.');
    }
  };

  const handleCraft = async () => {
    setError('');
    setDmMessage('');

    if (selectedNames.some((name) => !name)) {
      setError('Select three ingredients to craft.');
      return;
    }

    if (new Set(selectedNames).size < 3) {
      setError('Choose three unique ingredients.');
      return;
    }

    const missing = selectedNames.find((name) => (inventoryMap.get(name) ?? 0) <= 0);
    if (missing) {
      setError(`Not enough ${missing} in inventory.`);
      return;
    }

    const recipeList = recipes[discipline] || [];
    if (!recipeList.length) {
      setError(`No recipes loaded for ${discipline}.`);
      return;
    }

    const outcome = calculateResult(selectedIngredients, discipline, recipeList);

    const wasDiscovered = Boolean(outcome.recipe?.discovered);
    const revealOnCraft = Boolean(outcome.recipe && !wasDiscovered);
    setResult({ ...outcome, wasDiscovered: wasDiscovered || revealOnCraft });
    setResultModalOpen(true);

    if (outcome.recipe && !wasDiscovered) {
      await markRecipeDiscovered(outcome.recipe);
    }

    if (!canWriteInventory) {
      setError('Sign in as DM or Party to deduct inventory.');
      return;
    }

    const updates = selectedNames.map((name) => ({
      name,
      quantity: Math.max(0, (inventoryMap.get(name) ?? 0) - 1)
    }));

    const updatedQuantities = new Map(updates.map((item) => [item.name, item.quantity]));

    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      updates.forEach((update) => {
        const index = next.findIndex((item) => item.name === update.name);
        if (index >= 0) {
          next[index].quantity = update.quantity;
        }
      });
      return next;
    });

    await persistInventory(updates);

    setSelectedNames((prev) =>
      prev.map((name) => {
        if (!name) return '';
        const nextQty = updatedQuantities.get(name);
        return nextQty === 0 ? '' : name;
      })
    );
  };

  const handleClear = () => {
    setSelectedNames(['', '', '']);
    setResult(null);
    setResultModalOpen(false);
    setError('');
  };

  const handleGrant = async () => {
    setDmMessage('');
    const quantity = Number(grantQuantity);
    if (!grantName) {
      setDmMessage('Pick an ingredient to grant.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDmMessage('Enter a positive quantity.');
      return;
    }
    if (!canWriteInventory) {
      setDmMessage('Sign in as DM to grant inventory.');
      return;
    }

    const current = inventoryMap.get(grantName) ?? 0;
    const nextQuantity = current + quantity;

    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const index = next.findIndex((item) => item.name === grantName);
      if (index >= 0) {
        next[index].quantity += quantity;
      } else {
        next.push({ name: grantName, quantity: nextQuantity });
      }
      return next;
    });

    await persistInventory([{ name: grantName, quantity: nextQuantity }]);
    setDmMessage(`Granted ${quantity} ${grantName}.`);
  };

  const handleInventoryEdit = async (name, value) => {
    const quantity = Math.max(0, Number(value));
    if (!canWriteInventory) {
      setDmMessage('Sign in as DM to update inventory.');
      return;
    }

    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const index = next.findIndex((item) => item.name === name);
      if (index >= 0) {
        next[index].quantity = quantity;
      } else {
        next.push({ name, quantity });
      }
      return next;
    });

    await persistInventory([{ name, quantity }]);
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!hasSupabase) return;
    setAuthLoading(true);
    setAuthMessage('');

    const email = buildLoginEmail(authUsername);
    if (!email) {
      setAuthMessage('Enter your username.');
      setAuthLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword
    });

    if (signInError) {
      setAuthMessage(signInError.message);
    } else {
      setAuthMessage('Signed in successfully.');
      setAuthPassword('');
      setAuthUsername('');
    }

    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    if (!hasSupabase) return;
    setAuthLoading(true);
    setAuthMessage('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setAuthMessage(signOutError.message);
    } else {
      setAuthMessage('Signed out.');
    }
    setAuthLoading(false);
  };

  if (showAuthOnly) {
    return (
      <main className="login-shell">
        <section className="panel login-panel">
          <div className="login-header">
            <p className="eyebrow">Arcane Access</p>
            <h2>Sign in to Craft</h2>
          </div>
          <form className="auth-form" onSubmit={handleSignIn}>
            <label className="select-field">
              <span>Username</span>
              <input
                type="text"
                value={authUsername}
                onChange={(event) => setAuthUsername(event.target.value)}
                placeholder="dm or party"
                required
              />
            </label>
            <label className="select-field">
              <span>Password</span>
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                required
              />
            </label>
            <div className="auth-actions">
              <button className="primary" type="submit" disabled={authLoading}>
                Enter the Workbench
              </button>
            </div>
          </form>
          {authMessage && <div className="panel-callout">{authMessage}</div>}
          {syncError && <div className="panel-callout error">{syncError}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-grid">
      <section className="panel auth-pill">
        <div className="auth-pill-head">
          <span className="badge">{hasSupabase ? userRole : 'Local'}</span>
          {hasSupabase && session && (
            <button className="ghost" type="button" onClick={handleSignOut} disabled={authLoading}>
              Log out
            </button>
          )}
        </div>
      </section>

      <section className="panel workbench">
        <div className="panel-header">
          <div>
            <h2>Workbench</h2>
            <p className="panel-subtitle">Craft with three ingredients and a discipline.</p>
          </div>
          <div className="panel-badges">
            <span className="badge">{discipline}</span>
            <div className={`expected-badge ${expectedBadgeClass}`}>
              <span className="expected-label">Expected</span>
              <span className="expected-name">{expectedLabel}</span>
            </div>
          </div>
        </div>

        {loading && <div className="panel-callout">Loading data...</div>}
        {loadError && <div className="panel-callout error">{loadError}</div>}

        <div className="workbench-grid">
          <div className="form-block">
            <h3>Ingredients</h3>
            <div className="select-grid">
              {selectedNames.map((value, index) => (
                <label className="select-field" key={`slot-${index}`}>
                  <span>Slot {index + 1}</span>
                  <select
                    value={value}
                    onChange={(event) => handleSelectChange(index, event.target.value)}
                  >
                    <option value="">Choose ingredient</option>
                    {inventoryRows
                      .filter((ingredient) => ingredient.quantity > 0)
                      .map((ingredient) => {
                      const alreadyPicked = selectedNames.includes(ingredient.name) && value !== ingredient.name;
                      return (
                        <option
                          key={ingredient.name}
                          value={ingredient.name}
                          disabled={alreadyPicked}
                        >
                          {ingredient.name} ({ingredient.quantity} left)
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
            </div>
            <button className="ghost" type="button" onClick={handleClear}>
              Clear selection
            </button>
          </div>

          <div className="form-block">
            <h3>Discipline</h3>
            <div className="discipline-grid">
              {DISCIPLINES.map((name) => (
                <label className="radio-card" key={name}>
                  <input
                    type="radio"
                    name="discipline"
                    value={name}
                    checked={discipline === name}
                    onChange={(event) => {
                      setDiscipline(event.target.value);
                      setResult(null);
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <p className="hint">Tie-breaker: {TIE_RULES[discipline]}</p>
          </div>
        </div>

        <div className="stat-grid">
          {Object.keys(ATTRIBUTE_LABELS).map((key) => (
            <div className="stat-card" key={key}>
              <span>{ATTRIBUTE_LABELS[key]}</span>
              <strong>{totals[key]}</strong>
            </div>
          ))}
        </div>

        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={handleCraft}
            disabled={loading || !!loadError}
          >
            Craft recipe
          </button>
        </div>

        {error && <div className="panel-callout error">{error}</div>}
        {syncError && <div className="panel-callout error">{syncError}</div>}
        {dominantAttribute && (
          <div className="panel-callout">
            Dominant attribute: {ATTRIBUTE_LABELS[dominantAttribute]}
            {isTie ? ' (tie-breaker applied)' : ''}
          </div>
        )}
      </section>

      <section className="panel inventory-panel">
        <div className="panel-header">
          <div>
            <h2>Party Inventory</h2>
            <p className="panel-subtitle">Shared ingredients and their properties.</p>
          </div>
        </div>
        <div className="inventory-list">
          {inventoryDisplayRows.map((ingredient) => (
            <div
              className={`inventory-row ${getRarityClass(ingredient.rarity)}`}
              key={ingredient.name}
            >
              <div>
                <h4>{ingredient.name}</h4>
                <p className="inventory-meta">
                  {ingredient.rarity} | {ingredient.source}
                </p>
                <p className="inventory-stats">
                  {ingredient.potency} / {ingredient.resonance} / {ingredient.entropy}
                </p>
              </div>
              <div className="inventory-qty">x{ingredient.quantity}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel almanac-panel">
        <div className="panel-header">
          <div>
            <h2>Almanac</h2>
            <p className="panel-subtitle">Known {discipline} recipes by dominant attribute.</p>
          </div>
          <span className="badge">{discipline}</span>
        </div>
        <div className="almanac-grid">
          {['Potency', 'Resonance', 'Entropy'].map((quality) => (
            <div className="almanac-column" key={quality}>
              <h3>{quality}</h3>
              <div className="almanac-slots">
                {Array.from({ length: 15 }, (_, index) => {
                  const slot = index + 1;
                  const recipe = almanacEntries[quality]?.[slot];
                  const isDiscovered = recipe?.discovered;
                  return (
                    <button
                      className={`almanac-slot ${isDiscovered ? 'discovered' : 'unknown'} ${getRarityClass(
                        recipe?.rarity
                      )}`}
                      key={`${quality}-${slot}`}
                      type="button"
                      disabled={!isDiscovered}
                      onClick={() => handleAlmanacSelect(recipe)}
                    >
                      <span className="slot-index">{slot}</span>
                      <span className="slot-name">{isDiscovered ? recipe?.name : '???'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {canEditData && (
        <section className="panel dm-panel">
          <div className="panel-header">
            <div>
              <h2>DM Tools</h2>
              <p className="panel-subtitle">Update campaign data and inventory.</p>
            </div>
            <span className="badge">DM</span>
          </div>
          <div className="dm-grid">
            <div className="dm-card">
              <h3>Grant ingredients</h3>
              <label className="select-field">
                <span>Ingredient</span>
                <select
                  value={grantName}
                  onChange={(event) => setGrantName(event.target.value)}
                >
                  {sortedIngredients.map((ingredient) => (
                    <option key={ingredient.name} value={ingredient.name}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={grantQuantity}
                  onChange={(event) => setGrantQuantity(event.target.value)}
                />
              </label>
              <button className="primary" type="button" onClick={handleGrant}>
                Grant
              </button>
            </div>

            <div className="dm-card">
              <h3>Edit inventory</h3>
              <div className="inventory-edit">
                {inventoryRows.map((ingredient) => (
                  <div
                    className={`inventory-edit-row ${getRarityClass(ingredient.rarity)}`}
                    key={`edit-${ingredient.name}`}
                  >
                    <span className="ingredient-name">{ingredient.name}</span>
                    <span className="ingredient-stats">
                      {ingredient.potency} / {ingredient.resonance} / {ingredient.entropy}
                    </span>
                    <input
                      className="inventory-input"
                      type="number"
                      min="0"
                      value={ingredient.quantity}
                      onChange={(event) =>
                        handleInventoryEdit(ingredient.name, event.target.value)
                      }
                      aria-label={`Inventory quantity for ${ingredient.name}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {dmMessage && <div className="panel-callout">{dmMessage}</div>}
          </div>
        </section>
      )}

      {resultModalOpen && result?.recipe && (
        <div className="modal-overlay" onClick={() => setResultModalOpen(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Crafted Result</h3>
              <button
                className="ghost"
                type="button"
                onClick={() => setResultModalOpen(false)}
              >
                Close
              </button>
            </div>
            {resultIsKnown ? (
              <div className={`result-card ${getRarityClass(result.recipe.rarity)}`}>
                <h3>{result.recipe.name}</h3>
                <p className="result-meta">
                  {result.recipe.category} | {result.recipe.rarity}
                </p>
                <p className="result-effect">{result.recipe.effect}</p>
                <div className="result-details">
                  <span>Dominant: {ATTRIBUTE_LABELS[result.dominantAttribute]}</span>
                  <span>
                    Tier: {result.tierIndex + 1} | Roll: {result.roll + 1}/15
                  </span>
                </div>
                {result.usedFallback && (
                  <p className="notice">Recipe list is short, so a fallback recipe was used.</p>
                )}
              </div>
            ) : (
              <div className="result-card result-unknown">
                <h3>Unknown Recipe</h3>
                <p className="result-meta">
                  {result.recipe.category} | {ATTRIBUTE_LABELS[result.dominantAttribute]}
                </p>
                <p className="result-effect">
                  This formula has not been discovered. Crafting it will reveal the recipe in the
                  Almanac.
                </p>
                <div className="result-details">
                  <span>Slot: {result.roll + 1}/15</span>
                  <span>Dominant: {ATTRIBUTE_LABELS[result.dominantAttribute]}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default IngredientSelector;
