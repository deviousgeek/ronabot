const Discord = require("discord.js");
const config = require("config");
const { orderBy, groupBy } = require("lodash");
const { format, add, parse, parseISO } = require("date-fns");
const safeEval = require("safe-eval");
const data = require("./lib/data");
const { dateBet, dateNow, resolveUser, numFmt } = require("./lib/util");
const {
  botUserId,
  moderatorPrefix,
  moderators,
  allowedChannels,
  commandPrefix,
  botStatus,
  betObjectName
} = config;

const getClient = () => {
  const { botToken } = config;
  const client = new Discord.Client();
  client.login(botToken);
  return client;
};

// Bot entrypont.
const main = () => {
  const client = getClient();

  client.on("ready", () => {
    console.log(
      `Connected and active as "${client.user.tag}" with status "${botStatus}".`
    );
    client.user.setActivity(botStatus);
  });

  client.on("message", (msg) => {
    // Validate incoming message.
    if (!msg.channel) return;
    if (msg.author.id && msg.author.id === botUserId) return;


    if (msg.content.includes("␇")) {
      msg.reply("🔔 Ding dong you're wrong.");
      return;
    }

    console.log(`============ (${new Date().toISOString()})`);
    console.log(
      `Incoming message from ${msg.author.username}#${msg.author.discriminator}: "${msg.content}".`
    );

    // Very basic command syntax validation.
    if (
      (msg.content.length || 0) < 2 ||
      !(
        msg.content.startsWith(commandPrefix) ||
        msg.content.startsWith(moderatorPrefix)
      )
    ) {
      return; // Just silently ignore normal noise.
    }

    // Drop messages that aren't DMs or from a specific channel.
    if (
      !(msg.channel.type === "dm" || allowedChannels.includes(msg.channel.id))
    ) {
      return;
    }

    if (
      (msg.content.startsWith("!bet ") || msg.content.startsWith("!b ")) &&
      msg.channel.type !== "dm"
    ) {
      return msg.reply("please place bets in a DM.");
    }

    const input = msg.content
      .toLowerCase()
      .substring(1)
      .replace(/\s\s+/g, " ")
      .split(" ");

    const isModeratorAction = msg.content.startsWith(moderatorPrefix);
    const isModerator = moderators.includes(msg.author.id);

    try {
      if (isModerator && isModeratorAction) {
        moderatorSwitch(input, msg);
      } else {
        commandSwitch(input, msg);
      }
    } catch (e) {
      msg.reply(`Uncaught: ${e}`);
    }
  });
};

// Switchboards.

const moderatorSwitch = (input, msg) => {
  const command = input.shift();
  const args = input;
  switch (command) {
    case "placed":
      return getPlacedBets(msg);
    case "set-result":
      return calculateResult(msg);
  }
};

const commandSwitch = (input, msg) => {
  const command = input.shift();
  const args = input;
  switch (command) {
    case "eval":
      return evaluate(msg);
    case "help":
    case "h":
      help(msg);
      break;
    case "bet":
    case "b":
      return placeBet(msg);
    case "bets":
    case "t":
      return getBets(msg);
    case "results":
    case "r":
      return getResults(msg);
    case "score":
    case "s":
      return getScoreboard(msg);
    case "leaderboard":
    case "x":
      return getLeaderboard(msg);
    case "regions":
    case "l":
      return getRegions(msg);
  }
};

// Command functions.

const help = (msg) => {
  let fields = [];

  fields.push({
    name: `The Game`,
    value: `
      This is a COVID-19 daily ${betObjectName} number betting bot.

      - Each day you can place a bet (for points) on the ${betObjectName} number in one or more regions for the _next day_. Bets can be placed and updated up to midnight (_23:59:59_).

      - Points are awarded based on how close you are to the announced ${betObjectName} number. 100 points for 1st, 50 for 2nd, 25 for 3rd, 10 for 4th, 5 for 5th and 1 for 6th. No points are awarded beyond this. There is also a leaderboard for average "distance" from the ${betObjectName} number.

      - Points for ties are split between the winners.

      - The score is calculated once the ${betObjectName} numbers have been confirmed for that region, which may not be at a consistent time every day.
      `,
  });

  fields.push({
    name: "Available Commands",
    value: `
        **${commandPrefix}help**/**${commandPrefix}h**: Returns this help text.
        **${commandPrefix}bet**/**${commandPrefix}b _region_ _amount_**: Places a bet for **tomorrow** in **_region_** with a given **_amount_**.
        **${commandPrefix}bets**/**${commandPrefix}t _[YYYY-MM-DD]_**: Shows your placed bets for today or a specified day.
        **${commandPrefix}leaderboard**/**${commandPrefix}x _[region]_**: Shows the global leaderboard, optionally per region.
        **${commandPrefix}regions**/**${commandPrefix}l**: Lists the regions / states that you are able to place bet on.
        **${commandPrefix}results**/**${commandPrefix}r _[YYYY-MM-DD]_**: Shows the results for today or a specified day.
        **${commandPrefix}score**/**${commandPrefix}s**: Shows your current total and per-region score.
      `,
  });

  msg.channel.send(
    new Discord.MessageEmbed().setTitle("RonaBot").addFields(fields)
  );
};

const getRegions = async (msg) => {
  return data.getRegions().then((regions) => {
    msg.channel.send(
      new Discord.MessageEmbed().setTitle("Regions").addFields([
        {
          name: `There are ${regions.length} regions open for betting:`,
          value: `
              ${regions
                .map((r) => "`" + r.value + "` - " + r.label)
                .sort()
                .join("\n")}
              Use the region acronym when betting.
            `,
        },
      ])
    );
  });
};

const calculateResult = async (msg) => {
  const parts = msg.content.split(" ");
  if (parts.length < 3 || parts.length > 4) {
    return msg.reply(
      `Specify a region and the ${betObjectName} number. (eg: \`$set-result nsw 150\`)`
    );
  }

  let overrideDate = undefined;
  if (parts.length === 4) {
    overrideDate = parts[3];
  }

  const region = (parts[1] || "").toLowerCase();
  const regions = await data.getRegions({ open: true });
  const dbRegion = regions.find((r) => r.value.toLowerCase() === region);
  if (!dbRegion) {
    return msg.reply("Specify a valid region.");
  }
  let amount = -1;
  try {
    amount = parseInt(parts[2]);
    if (amount < 0 || amount > 900000000 || isNaN(amount)) {
      return msg.reply("Amount not valid.");
    }
  } catch (e) {
    return msg.reply("Amount not valid.");
  }

  const date = overrideDate || dateNow();
  // We have a valid amount and region.
  // Remember that we're calculating the results for today, not tomorrow.

  const existing = await data.getResults({ regionId: dbRegion.value, date });
  if (existing.length) {
    msg.reply("Yeah I just saved your life.");
    return;
  }

  // 1. Add a result record for the region and date.
  const result = { date, regionId: dbRegion.value, amount };
  await data.addResult(result);

  // 2. Get all of bets for the region today.
  const bets = await data.findBets({ date, regionId: dbRegion.value });

  // 3. Calculate the scores for the bets.
  let withDistance = orderBy(
    bets.map((bet) => ({
      ...bet,
      distance: Math.abs(amount - bet.bet),
    })),
    ["distance"],
    ["asc"]
  );

  const scores = [];
  const processed = [];
  let place = 1;

  for (const bet of withDistance) {
    // Find out who else got the same distance.
    const drawCount = withDistance.filter((s) => s.distance === bet.distance);
    const drawLength = drawCount.length;

    // Calculate the actual score they got. Divide if if there's > 1 drawCount.
    const potentialPoints = config.points[place - 1]
      ? config.points[place - 1]
      : 0;
    let points = potentialPoints;
    if (drawLength > 1) {
      points = Math.round(potentialPoints / drawLength);
    }

    const score = {
      userId: bet.userId,
      regionId: bet.regionId,
      score: points,
      distance: bet.distance,
      date,
    };

    scores.push(score);

    // Is this the last draw to process?
    const processedDrawLength = processed.filter(
      (s) => s.distance === bet.distance
    ).length;

    const isLastDraw = processedDrawLength === drawLength - 1;
    if (drawLength <= 1 || isLastDraw) {
      place = place + 1;
    }

    processed.push(bet);
  }
  await data.addScores(scores);
  await msg.reply(
    `Calculated the result for (Date => ${date}, Region: ${region}, Amount: ${amount}) with ${bets.length} bets.`
  );
  return getResults({ ...msg, content: " " });
};

const getPlacedBets = async (msg) => {
  const date = dateBet();
  const bets = await data.findBets({ date });
  const byRegionId = groupBy(bets, "regionId");
  return msg.reply(
    `For **${date}**, there are **${
      bets.length
    } bet(s)** placed, broken into ${Object.keys(byRegionId)
      .map((regionId) => {
        return `${regionId}: ${byRegionId[regionId].length}`;
      })
      .join(", ")}.`
  );
};

const evaluate = async (msg) => {
  if ((msg.content || "").length === 5)
    return msg.reply(
      "`!eval` lets you execute an expression in the V8 engine. You can access your message `content` and bot database using the `db` object variables."
    );
  const req = (msg.content || "").slice(5);
  let db = {};

  db.score = await data.getScores({});
  db.result = await data.getResults({});
  db.region = await data.getRegions({});
  db.bet = { Nice: "Try" };

  try {
    const result = safeEval(req, { content: msg.content, db, msg });
    if (result && !!result.then) {
      result.then((res) => {
        if (res) {
          return msg.reply("```" + res + "```");
        }
      });
    } else {
      return msg.reply("```" + result + "```");
    }
  } catch (e) {
    return msg.reply("```" + e.toString() + "```");
  }
};

const placeBet = async (msg) => {
  // Break the command into region and amount, and validate both.
  const regions = await data.getRegions();
  const parts = msg.content.split(" ");

  // Message must be exactly 3 words long.
  if (parts.length !== 3) {
    return msg.reply(
      "Oi, you need to specify exactly two arguments and try again. (eg: `!bet nsw 100`)"
    );
  }

  const region = (parts[1] || "").toLowerCase();
  let amount = -1;
  try {
    amount = parseInt(parts[2]);
    if (amount < 0 || amount > 900000000 || isNaN(amount)) {
      return msg.reply(
        "Oi, the amount must be 0 or greater, and less than 900 million (you awful person)."
      );
    }
  } catch (e) {
    return msg.reply("Oi, please specify a valid, whole number amount.");
  }

  const dbRegion = regions.find((r) => r.value.toLowerCase() === region);
  if (!dbRegion) {
    return msg.reply(
      "Oi, the region you specified is not valid. Type !regions to find out what you need to put in."
    );
  }

  // Check to see if they have already bet today.
  const date = dateBet();
  const userId = resolveUser(msg.author);

  const existingBet = await data.findBet({
    regionId: dbRegion.value,
    userId,
    date,
  });

  let message = null;
  if (existingBet) {
    if (existingBet.bet === amount) {
      return msg.reply(
        `🤷 Your already have a bet of **${numFmt(existingBet.bet)}** in **${existingBet.regionId}** for **${existingBet.date}**. There's nothing to do!`
      );
    }
    message = new Discord.MessageEmbed().setTitle(`🎟 Update Bet`).addFields([
      {
        name: `Your bet: ${numFmt(amount)} ${betObjectName}s.`,
        value: `\n\nYou already have a bet of ${numFmt(existingBet.bet)} for **${dbRegion.value}** on the **${date}**.\n
        Would you like to change it to **${numFmt(amount)}**?\n
      React with ✅ to confirm or ❌ to decline (within 60 seconds).
      `,
      },
    ]);
  } else {
    message = new Discord.MessageEmbed().setTitle(`🎟 Place Bet`).addFields([
      {
        name: `Your bet: ${numFmt(amount)} ${betObjectName}s.`,
        value: `\n\nAre you sure you'd like to place this bet for **${dbRegion.value}** on **${date}**?\n
      React with ✅ to confirm or ❌ to decline (within 60 seconds).
      `,
      },
    ]);
  }

  sent = await msg.channel.send(message);

  collector = sent.createReactionCollector(
    (reaction) => ["✅", "❌"].includes(reaction.emoji.name),
    { time: 60000 }
  );

  sent.react("✅");
  sent.react("❌");

  const targetUserId = msg.author.id;

  collector.on("collect", async (reaction, user) => {
    if (user.id !== targetUserId) return;
    await collector.stop();
    if (reaction.emoji.name === "❌") {
      if (!existingBet) {
        return msg.channel.send(`OK! No bet made.`);
      } else {
        return msg.channel.send(
          `OK! Your bet remains at **${numFmt(existingBet.bet)}**.`
        );
      }
    } else {
      const query = {
        regionId: dbRegion.value,
        userId,
        date,
      };
      const bet = {
        ...query,
        updated: new Date(),
        bet: amount,
      };
      const placed = await data.placeBet(query, bet);
      if (placed.updated > 0 || placed.inserted > 0) {
        return msg.reply(`👍 Bet placed.`);
      } else {
        return msg.reply(`👎 Dang, your bet wasn't able to be placed. Sorry!`);
      }
    }
  });
};

const getLeaderboard = async (msg) => {
  const scores = await data.getScores({});
  const parts = msg.content.split(" ");
  let withDistance = false;

  // Message must be exactly 3 words long.
  if (parts.length > 2) {
    return msg.reply(
      "Oi, you need to specify one or no arguments and try again. (eg: `!leaderboard distance`)"
    );
  }

  if (parts[1] == "distance") {
    withDistance = true;
  }

  if (!scores.length) {
    msg.reply("No scores yet!");
  }

  let byUserId = {};
  let byRegionId = {};
  for (let score of scores) {
    if (!byUserId[score.userId]) byUserId[score.userId] = 0;
    if (!byRegionId[score.regionId]) byRegionId[score.regionId] = [];
    byUserId[score.userId] += withDistance ? score.distance : score.score;
    byRegionId[score.regionId].push(score);
  }

  for (const [regionId, scores] of Object.entries(byRegionId)) {
    let regionByUserId = {};
    for (let score of scores) {
      if (!regionByUserId[score.userId]) regionByUserId[score.userId] = 0;
      regionByUserId[score.userId] += withDistance
        ? score.distance
        : score.score;
    }
    const list = [];
    for (const [key, value] of Object.entries(regionByUserId)) {
      list.push({
        userId: key,
        score: withDistance
          ? Math.round(value / scores.filter((s) => s.userId === key).length)
          : value,
      });
    }
    byRegionId[regionId] = orderBy(
      list,
      ["score"],
      [withDistance ? "asc" : "desc"]
    ).slice(0, 5);
  }

  const asList = [];
  for (const [key, value] of Object.entries(byUserId)) {
    asList.push({
      userId: key,
      score: withDistance
        ? Math.round(value / scores.filter((s) => s.userId === key).length)
        : value,
    });
  }

  const sorted = orderBy(
    asList,
    ["score"],
    [withDistance ? "asc" : "desc"]
  ).slice(0, 5);

  return msg.channel.send(
    new Discord.MessageEmbed()
      .setTitle(`Leaderboard${withDistance ? " (Distance)" : ""}`)
      .addFields([
        {
          name: "Top 5 (Global)",
          value: `
        ${sorted
          .map(
            (s, i) =>
              `${i + 1}. ${s.userId} - **${withDistance ? "± " : ""}${
                numFmt(s.score)
              }**`
          )
          .join("\n")}
        `,
        },
        ...Object.keys(byRegionId).map((regionId) => {
          const scores = byRegionId[regionId];
          return {
            name: `Top 5 ${regionId}`,
            value: scores
              .map(
                (s, i) =>
                  `${i + 1}. ${s.userId} - **${withDistance ? "± " : ""}${
                    numFmt(s.score)
                  }**`
              )
              .join("\n"),
          };
        }),
        {
          name: "More",
          value: withDistance
            ? `Use **${commandPrefix}leaderboard**/**${commandPrefix}x** to see who has the most points.`
            : `Use **${commandPrefix}leaderboard**/**${commandPrefix}x** **_distance_** to see who is the most accurate.`,
        },
      ])
  );
};

const getResults = async (msg) => {
  const date = dateNow();

  const parts = msg.content.split(" ");
  let inputDateFormatted = date;

  if (parts.length > 2) {
    return msg.reply(
      "Oi, you need to specify exactly one or no arguments and try again. (eg: `!results or !results 2021-07-26`)"
    );
  }

  if (parts.length > 1) {
    inputDateFormatted = parts[1];
  }

  const scores = await data.getScores({ date: inputDateFormatted });
  const results = await data.getResults({ date: inputDateFormatted });
  if (!scores.length) {
    return msg.reply(`There are no results for ${inputDateFormatted} yet.`);
  }

  let byRegionId = {};
  for (let score of scores) {
    if (!byRegionId[score.regionId]) byRegionId[score.regionId] = [];
    byRegionId[score.regionId].push(score);
  }

  for (const [regionId, scores] of Object.entries(byRegionId)) {
    let regionByUserId = {};
    for (let score of scores) {
      if (!regionByUserId[score.userId])
        regionByUserId[score.userId] = {
          score: 0,
          distance: 0,
          tied: !!scores.filter(
            (s) => s.userId !== score.userId && score.score === s.score
          ).length,
        };
      regionByUserId[score.userId] = {
        score: regionByUserId[score.userId].score + score.score,
        distance: regionByUserId[score.userId].distance + score.distance,
        tied: score.score > 0 ? regionByUserId[score.userId].tied : false,
      };
    }
    const list = [];
    for (const [key, value] of Object.entries(regionByUserId)) {
      list.push({
        userId: key,
        score: value.score,
        distance: value.distance,
        tied: value.tied,
      });
    }

    byRegionId[regionId] = orderBy(list, ["distance"], ["asc"]).filter(
      (r) => r.score !== 0
    );
  }

  return msg.channel.send(
    new Discord.MessageEmbed()
      .setTitle(`Score Results for ${inputDateFormatted}`)
      .addFields([
        ...Object.keys(byRegionId).map((regionId) => {
          const scores = byRegionId[regionId];
          const result = results.find((r) => r.regionId === regionId);
          if (!result) return;
          return {
            name: `${regionId} - ${numFmt(result.amount)} ${betObjectName}${
              result.amount > 1 ? "s" : ""
            }`,
            value: scores
              .map(
                (s, i) =>
                  `${i + 1}. ${s.userId} - **${s.score}${
                    s.tied ? "t" : ""
                  }** (± ${numFmt(s.distance)} ${betObjectName}${s.distance > 1 ? "s" : ""})`
              )
              .join("\n"),
          };
        }),
        {
          name: "Notes",
          value:
            `_user#name_ **points awarded** (± distance from real ${betObjectName} number).\nA **t** indicates that there is a tie with another user and that the score has been split up.`,
        },
      ])
  );
};

const getScoreboard = async (msg) => {
  const userId = resolveUser(msg.author);
  const scores = await data.getScores({ userId });
  const totalScore = scores.reduce((acc, cur) => acc + cur.score, 0);
  const grouped = scores.reduce((acc, cur) => {
    if (!acc[cur.regionId]) {
      acc[cur.regionId] = {
        score: cur.score,
        distance: cur.distance,
      };
    } else {
      acc[cur.regionId] = {
        score: acc[cur.regionId].score + cur.score,
        distance: acc[cur.regionId].distance + cur.distance,
      };
    }
    return acc;
  }, {});

  return msg.channel.send(
    new Discord.MessageEmbed().setTitle(`Your Score`).addFields([
      {
        name: "Breakdown",
        value:
          Object.keys(grouped).length > 0
            ? `
        ${Object.keys(grouped)
          .map(
            (k) =>
              `${k} - **${numFmt(grouped[k].score)}** point${
                grouped[k].score > 1 ? "s" : ""
              } / ± **${numFmt(grouped[k].distance)}** total distance.`
          )
          .join("\n")}
        `
            : "_Empty_.",
      },
      {
        name: "Total",
        value: `**${numFmt(totalScore)}** point${totalScore > 1 ? "s" : ""}`,
      },
    ])
  );
};

const getBets = async (msg) => {
  const parts = msg.content.split(" ");
  let date = dateBet();
  let inputDateFormatted = date;

  const userId = resolveUser(msg.author);
  if (parts.length > 2) {
    return msg.reply(
      "Oi, you need to specify exactly one or no arguments and try again. (eg: `!bets or !bets 2021-07-26`)"
    );
  }

  if (parts.length > 1) {
    inputDateFormatted = parts[1];
  }

  const bets = await data.findBets({
    userId,
    date: parts.length > 1 ? parts[1] : date,
  });

  if (!bets.length) {
    return msg.reply(`Sorry, you have no bets for **${inputDateFormatted}**.`);
  }

  msg.channel.send(
    new Discord.MessageEmbed()
      .setTitle(`Your Bets for ${inputDateFormatted}`)
      .addFields(
        bets.map((bet) => ({
          name: `${bet.regionId}`,
          value: `\n**Bet**: ${numFmt(bet.bet)}\n**Placed**: ${format(
            parseISO(bet.updated),
            "yyyy-MM-dd HH:mm:ss"
          )}\n`,
        }))
      )
  );
};

main();
