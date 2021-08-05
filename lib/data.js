const config = require("config");
const diskdb = require("diskdb");

// Ugh.
const db = diskdb.connect(config.database.file, [
  "region",
  "result",
  "bet",
  "score",
]);

const getRegions = async () => {
  return await db.region.find({ open: true });
};

const setRegions = async () => {
  const { regions } = config;
  try {
    // Re-create regions.
    await db.region.remove();
    await db.loadCollections(["region"]);

    // Add the new region settings.
    await db.region.save(regions);
    const added = await db.region.find();

    return `Added ${added.length} region(s).`;
  } catch (e) {
    console.dir(e);
    return `Unable to add regions (${e.message})`;
  }
};

const findBet = async (query) => {
  const results = db.bet.find(query);
  if (results.length > 0) {
    return results[0];
  }
  return null;
};

const placeBet = async (query, bet) => {
  const existing = await db.bet.find(query);
  if (existing.length > 0) {
    const result = await db.bet.update({ _id: existing[0]._id }, bet);
    return result;
  } else {
    const result = await db.bet.save(bet);
    return result;
  }
};

const findBets = async (query) => {
  const results = await db.bet.find(query);
  return results || [];
};

const getScores = async (query) => {
  const results = await db.score.find(query);
  return results || [];
};

const getResults = async (query) => {
  const results = await db.result.find(query);
  return results || [];
};

const addScores = async (data) => {
  return await db.score.save(data);
};

const addResult = async (data) => {
  return await db.result.save(data);
};

module.exports = {
  getRegions,
  setRegions,
  findBets,
  findBet,
  placeBet,
  addResult,
  addScores,
  getScores,
  getResults
};
