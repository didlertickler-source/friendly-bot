require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const games = new Map();

const formations = {
  4: {
    "2-1": ["GK", "LB", "RB", "ST"],
    "1-2": ["GK", "CB", "CAM", "ST"]
  },

  5: {
    "2-2": ["GK", "LB", "RB", "CAM", "ST"],
    "1-2-1": ["GK", "CB", "LM", "RM", "ST"]
  },

  6: {
    "2-2-1": ["GK", "LB", "RB", "LM", "RM", "ST"],
    "3-1-1": ["GK", "LB", "CB", "RB", "CAM", "ST"]
  },

  7: {
    "3-1-2": ["GK", "LB", "CB", "RB", "CAM", "LW", "ST"],
    "2-2-2": ["GK", "LB", "RB", "LM", "RM", "LW", "ST"]
  },

  8: {
    "3-1-3": ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"],
    "2-2-3": ["GK", "LB", "RB", "LM", "RM", "LW", "ST", "RW"],
    "3-2-2": ["GK", "LB", "CB", "RB", "CM", "CAM", "LW", "ST"]
  },

  9: {
    "3-2-3": ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"],
    "4-1-3": ["GK", "LB", "CB", "CB", "RB", "CAM", "LW", "ST", "RW"]
  },

  10: {
    "4-2-3": ["GK", "LB", "CB", "CB", "RB", "CDM", "CM", "LW", "ST", "RW"],
    "3-3-3": ["GK", "LB", "CB", "RB", "LCM", "CAM", "RCM", "LW", "ST", "RW"]
  },

  11: {
    "4-3-3": [
      "GK",
      "LB",
      "LCB",
      "RCB",
      "RB",
      "LCM",
      "CM",
      "RCM",
      "LW",
      "ST",
      "RW"
    ],

    "4-2-3-1": [
      "GK",
      "LB",
      "LCB",
      "RCB",
      "RB",
      "CDM",
      "CM",
      "LW",
      "CAM",
      "RW",
      "ST"
    ]
  }
};

function makeButton(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style);
}

function activityEmbed(game) {
  const players = [...game.players.values()];

  return new EmbedBuilder()
    .setTitle("⚽ FRIENDLY ACTIVITY CHECK")
    .setDescription(
      `**${game.required} players needed**\n\n` +
      `🟩 **Can Play:** ${players.length}/${game.required}\n` +
      `🟥 **Can't Play:** ${game.unavailable.size}\n\n` +
      `Click **🟩 CAN PLAY** if you're available.`
    )
    .setColor(0x111111)
    .setFooter({
      text: `Friendly • ${players.length}/${game.required}`
    });
}

function activityButtons() {
  return new ActionRowBuilder().addComponents(
    makeButton("can_play", "🟩 CAN PLAY", ButtonStyle.Success),
    makeButton("cant_play", "🟥 CAN'T PLAY", ButtonStyle.Danger),
    makeButton("reset_friendly", "↻ RESET", ButtonStyle.Secondary)
  );
}

function formationEmbed(game) {
  return new EmbedBuilder()
    .setTitle("⚽ CHOOSE FORMATION")
    .setDescription(
      `**Players:** ${game.required}\n` +
      `**Available:** ${game.players.size}/${game.required}\n\n` +
      `Choose the formation for this friendly.`
    )
    .setColor(0x111111)
    .setFooter({
      text: "Formation Selection"
    });
}

function formationButtons(game) {
  const available = formations[game.required];

  const rows = [];
  let row = new ActionRowBuilder();

  for (const formation of Object.keys(available)) {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    row.addComponents(
      makeButton(
        `formation_${formation}`,
        formation,
        ButtonStyle.Secondary
      )
    );
  }

  if (row.components.length > 0) {
    rows.push(row);
  }

  return rows;
}

function lineupEmbed(game) {
  const lines = [];

  for (const position of game.positions) {
    const userId = game.lineup.get(position);

    lines.push(
      `**${position}** — ${
        userId ? `<@${userId}>` : "▫️ OPEN"
      }`
    );
  }

  return new EmbedBuilder()
    .setTitle("📋 LINEUP")
    .setDescription(
      `**Formation:** \`${game.formation}\`\n\n` +
      lines.join("\n")
    )
    .setColor(0x111111)
    .setFooter({
      text: "Choose a position • One position per player"
    });
}

function lineupButtons(game) {
  const rows = [];
  let row = new ActionRowBuilder();

  for (const position of game.positions) {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    const taken = game.lineup.has(position);

    row.addComponents(
      makeButton(
        `position_${position}`,
        taken ? `✓ ${position}` : position,
        taken ? ButtonStyle.Success : ButtonStyle.Secondary
      ).setDisabled(taken)
    );
  }

  if (row.components.length > 0) {
    rows.push(row);
  }

  const lockRow = new ActionRowBuilder().addComponents(
    makeButton(
      "lock_lineup",
      "🔒 LOCK LINEUP",
      ButtonStyle.Success
    )
  );

  rows.push(lockRow);

  return rows;
}

async function startLineup(interaction, game) {
  game.lineupStarted = true;

  const embed = lineupEmbed(game);
  const rows = lineupButtons(game);

  await interaction.channel.send({
    embeds: [embed],
    components: rows
  });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("friendly")
      .setDescription("Start a football friendly")
      .addIntegerOption(option =>
        option
          .setName("players")
          .setDescription("Number of players needed")
          .setRequired(true)
          .setMinValue(4)
          .setMaxValue(11)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(
    process.env.TOKEN
  );

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log("Slash command registered.");
  } catch (error) {
    console.error(error);
  }
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "friendly") return;

    const required = interaction.options.getInteger("players");

    const game = {
      hostId: interaction.user.id,
      required,
      players: new Map(),
      unavailable: new Set(),
      formation: null,
      positions: [],
      lineup: new Map(),
      lineupStarted: false,
      channelId: interaction.channelId
    };

    games.set(interaction.channelId, game);

    const embed = activityEmbed(game);
    const buttons = activityButtons();

    await interaction.reply({
      content: "@everyone",
      embeds: [embed],
      components: [buttons],
      allowedMentions: {
        parse: ["everyone"]
      }
    });
  }

  if (!interaction.isButton()) return;

  const game = games.get(interaction.channelId);

  if (!game) {
    return interaction.reply({
      content: "❌ There isn't an active friendly.",
      ephemeral: true
    });
  }

  if (interaction.customId === "can_play") {
    if (game.lineupStarted) {
      return interaction.reply({
        content: "❌ The lineup has already started.",
        ephemeral: true
      });
    }

    game.players.set(
      interaction.user.id,
      interaction.user.username
    );

    game.unavailable.delete(interaction.user.id);

    await interaction.update({
      embeds: [activityEmbed(game)],
      components: [activityButtons()]
    });

    if (
      game.players.size >= game.required &&
      !game.formation
    ) {
      await interaction.channel.send({
        embeds: [formationEmbed(game)],
        components: formationButtons(game)
      });
    }

    return;
  }

  if (interaction.customId === "cant_play") {
    if (game.lineupStarted) {
      return interaction.reply({
        content: "❌ The lineup has already started.",
        ephemeral: true
      });
    }

    game.players.delete(interaction.user.id);
    game.unavailable.add(interaction.user.id);

    await interaction.update({
      embeds: [activityEmbed(game)],
      components: [activityButtons()]
    });

    return;
  }

  if (interaction.customId === "reset_friendly") {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({
        content: "❌ Only the friendly host can reset it.",
        ephemeral: true
      });
    }

    games.delete(interaction.channelId);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("♻️ FRIENDLY RESET")
          .setDescription("This friendly has been reset.")
          .setColor(0x111111)
      ],
      components: []
    });

    return;
  }

  if (interaction.customId.startsWith("formation_")) {
    const formation = interaction.customId.replace(
      "formation_",
      ""
    );

    if (!formations[game.required]?.[formation]) {
      return interaction.reply({
        content: "❌ Invalid formation.",
        ephemeral: true
      });
    }

    game.formation = formation;
    game.positions = formations[game.required][formation];

    await interaction.update({
      embeds: [lineupEmbed(game)],
      components: lineupButtons(game)
    });

    game.lineupStarted = true;

    return;
  }

  if (interaction.customId.startsWith("position_")) {
    if (!game.lineupStarted) {
      return interaction.reply({
        content: "❌ The lineup hasn't started yet.",
        ephemeral: true
      });
    }

    const position = interaction.customId.replace(
      "position_",
      ""
    );

    if (!game.positions.includes(position)) {
      return interaction.reply({
        content: "❌ Invalid position.",
        ephemeral: true
      });
    }

    if (!game.players.has(interaction.user.id)) {
      return interaction.reply({
        content: "❌ You must click 🟩 CAN PLAY first.",
        ephemeral: true
      });
    }

    for (const [pos, userId] of game.lineup) {
      if (userId === interaction.user.id) {
        game.lineup.delete(pos);
      }
    }

    if (game.lineup.has(position)) {
      return interaction.reply({
        content: "❌ That position is already taken.",
        ephemeral: true
      });
    }

    game.lineup.set(position, interaction.user.id);

    await interaction.update({
      embeds: [lineupEmbed(game)],
      components: lineupButtons(game)
    });

    return;
  }

  if (interaction.customId === "lock_lineup") {
    if (interaction.user.id !== game.hostId) {
      return interaction.reply({
        content: "❌ Only the friendly host can lock the lineup.",
        ephemeral: true
      });
    }

    if (game.lineup.size < game.positions.length) {
      return interaction.reply({
        content:
          `❌ The lineup isn't full yet.\n\n` +
          `Filled: **${game.lineup.size}/${game.positions.length}**`,
        ephemeral: true
      });
    }

    const finalLines = [];

    for (const position of game.positions) {
      const userId = game.lineup.get(position);

      finalLines.push(
        `**${position}** — <@${userId}>`
      );
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle("🔒 LINEUP LOCKED")
      .setDescription(
        `**${game.formation}**\n\n` +
        finalLines.join("\n") +
        `\n\n━━━━━━━━━━━━━━━━━━\n` +
        `⚽ **GOOD LUCK — HAVE A GOOD GAME**`
      )
      .setColor(0x111111);

    await interaction.update({
      embeds: [finalEmbed],
      components: []
    });

    games.delete(interaction.channelId);

    return;
  }
});

client.login(process.env.TOKEN);
