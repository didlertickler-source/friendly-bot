const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const games = new Map();

const formations = {
  4: {
    name: "1-2-1",
    positions: ["GK", "LB", "RB", "ST"]
  },
  5: {
    name: "1-2-1-1",
    positions: ["GK", "LB", "RB", "CAM", "ST"]
  },
  6: {
    name: "1-2-1-2",
    positions: ["GK", "LB", "RB", "CAM", "LW", "ST"]
  },
  7: {
    name: "1-3-1-2",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST"]
  },
  8: {
    name: "1-3-1-3",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"]
  },
  9: {
    name: "1-3-2-3",
    positions: ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  10: {
    name: "1-4-2-3",
    positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  11: {
    name: "1-4-3-3",
    positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "CAM", "RCM", "LW", "ST", "RW"]
  }
};

const command = new SlashCommandBuilder()
  .setName("friendly")
  .setDescription("Start a friendly match")
  .addIntegerOption(option =>
    option
      .setName("players")
      .setDescription("Number of players needed")
      .setRequired(true)
      .setMinValue(4)
      .setMaxValue(11)
  );

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: [command.toJSON()] }
  );

  console.log("Friendly system loaded.");
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "friendly") return;

    const needed = interaction.options.getInteger("players");

    if (games.has(interaction.guildId)) {
      return interaction.reply({
        content: "❌ There is already a friendly running in this server.",
        ephemeral: true
      });
    }

    const formation = formations[needed];

    const game = {
      needed,
      players: new Set(),
      lineup: new Map(),
      channelId: interaction.channelId,
      activityMessageId: null,
      lineupMessageId: null
    };

    games.set(interaction.guildId, game);

    const embed = createActivityEmbed(game, formation);

    const message = await interaction.reply({
      content: "@everyone",
      embeds: [embed],
      components: createActivityButtons(),
      allowedMentions: { parse: ["everyone"] },
      fetchReply: true
    });

    game.activityMessageId = message.id;
    return;
  }

  if (!interaction.isButton()) return;

  const game = games.get(interaction.guildId);

  if (!game) {
    return interaction.reply({
      content: "❌ There is no active friendly.",
      ephemeral: true
    });
  }

  if (interaction.customId === "can_play") {
    if (game.players.has(interaction.user.id)) {
      return interaction.reply({
        content: "🟩 You're already marked as available.",
        ephemeral: true
      });
    }

    game.players.add(interaction.user.id);

    await updateActivity(interaction);

    if (game.players.size >= game.needed) {
      await createLineup(interaction);
    }

    return;
  }

  if (interaction.customId === "cant_play") {
    game.players.delete(interaction.user.id);

    for (const [position, userId] of game.lineup) {
      if (userId === interaction.user.id) {
        game.lineup.delete(position);
      }
    }

    await updateActivity(interaction);

    return;
  }

  if (interaction.customId === "reset_friendly") {
    games.delete(interaction.guildId);

    return interaction.update({
      content: "🛑 **Friendly cancelled.**",
      embeds: [],
      components: []
    });
  }

  if (interaction.customId.startsWith("position_")) {
    const position = interaction.customId.replace("position_", "");

    if (!game.players.has(interaction.user.id)) {
      return interaction.reply({
        content: "❌ You didn't sign up for this friendly.",
        ephemeral: true
      });
    }

    if (game.lineup.has(position)) {
      return interaction.reply({
        content: `❌ **${position}** is already taken.`,
        ephemeral: true
      });
    }

    for (const [oldPosition, userId] of game.lineup) {
      if (userId === interaction.user.id) {
        return interaction.reply({
          content: `❌ You already selected **${oldPosition}**.`,
          ephemeral: true
        });
      }
    }

    game.lineup.set(position, interaction.user.id);

    await updateLineup(interaction);

    return interaction.reply({
      content: `✅ You are now **${position}**.`,
      ephemeral: true
    });
  }
});

function createActivityButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("can_play")
        .setLabel("CAN PLAY")
        .setEmoji("🟩")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("cant_play")
        .setLabel("CAN'T PLAY")
        .setEmoji("🟥")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("reset_friendly")
        .setLabel("RESET")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createActivityEmbed(game, formation) {
  const progress = game.players.size >= game.needed
    ? "🟢 **READY**"
    : `🟡 **${game.players.size}/${game.needed}**`;

  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle("⚽  FRIENDLY MATCH")
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "**ACTIVITY CHECK**\n" +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      `${progress}\n\n` +
      `**Players required:** \`${game.needed}\`\n` +
      `**Formation:** \`${formation.name}\`\n\n` +
      "🟩 **CAN PLAY**\n" +
      "🟥 **CAN'T PLAY**\n\n" +
      "━━━━━━━━━━━━━━━━━━━━"
    )
    .setFooter({
      text: "Friendly System • Select your availability"
    });
}

async function updateActivity(interaction) {
  const game = games.get(interaction.guildId);

  if (!game) return;

  const formation = formations[game.needed];

  const message = await interaction.channel.messages.fetch(
    game.activityMessageId
  );

  await message.edit({
    embeds: [createActivityEmbed(game, formation)],
    components: createActivityButtons()
  });

  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferUpdate();
  }
}

async function createLineup(interaction) {
  const game = games.get(interaction.guildId);

  if (!game || game.lineupMessageId) return;

  const formation = formations[game.needed];

  const embed = createLineupEmbed(game, formation);

  const rows = createPositionButtons(game, formation);

  const message = await interaction.channel.send({
    content: "━━━━━━━━━━━━━━━━━━━━\n**LINEUP IS READY**\n━━━━━━━━━━━━━━━━━━━━",
    embeds: [embed],
    components: rows
  });

  game.lineupMessageId = message.id;
}

function createLineupEmbed(game, formation) {
  let lineup = "";

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    if (userId) {
      lineup += `**${position}**  →  <@${userId}>\n`;
    } else {
      lineup += `**${position}**  →  \`AVAILABLE\`\n`;
    }
  }

  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle("⚽  MATCH LINEUP")
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `**FORMATION  ${formation.name}**\n` +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      lineup +
      "\n━━━━━━━━━━━━━━━━━━━━\n" +
      "Select an available position below."
    )
    .setFooter({
      text: "One player • One position"
    });
}

function createPositionButtons(game, formation) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const position of formation.positions) {
    const taken = game.lineup.has(position);

    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(position)
      .setStyle(taken ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(taken);

    currentRow.addComponents(button);

    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

async function updateLineup(interaction) {
  const game = games.get(interaction.guildId);

  if (!game || !game.lineupMessageId) return;

  const formation = formations[game.needed];

  const message = await interaction.channel.messages.fetch(
    game.lineupMessageId
  );

  await message.edit({
    embeds: [createLineupEmbed(game, formation)],
    components: createPositionButtons(game, formation)
  });
}

client.login(process.env.TOKEN);