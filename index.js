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
    name: "2-1",
    positions: ["GK", "LB", "RB", "ST"]
  },
  5: {
    name: "2-1-1",
    positions: ["GK", "LB", "RB", "CAM", "ST"]
  },
  6: {
    name: "2-1-2",
    positions: ["GK", "LB", "RB", "CAM", "LW", "RW"]
  },
  7: {
    name: "3-1-2",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "RW"]
  },
  8: {
    name: "3-1-3",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"]
  },
  9: {
    name: "3-2-3",
    positions: ["GK", "LB", "CB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  10: {
    name: "4-2-3",
    positions: [
      "GK",
      "LB",
      "LCB",
      "RCB",
      "RB",
      "LCM",
      "RCM",
      "LW",
      "ST",
      "RW"
    ]
  },
  11: {
    name: "4-3-3",
    positions: [
      "GK",
      "LB",
      "LCB",
      "RCB",
      "RB",
      "LCM",
      "CAM",
      "RCM",
      "LW",
      "ST",
      "RW"
    ]
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

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [command.toJSON()]
      }
    );

    console.log("Friendly system loaded.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "friendly") return;

      if (!interaction.guildId) {
        return interaction.reply({
          content: "This command can only be used inside a server.",
          ephemeral: true
        });
      }

      const needed = interaction.options.getInteger("players");
      const formation = formations[needed];

      if (!formation) {
        return interaction.reply({
          content: "Invalid player count.",
          ephemeral: true
        });
      }

      if (games.has(interaction.guildId)) {
        return interaction.reply({
          content: "There is already a friendly running in this server.",
          ephemeral: true
        });
      }

      const game = {
        hostId: interaction.user.id,
        needed,
        players: new Set(),
        lineup: new Map(),
        messageId: null,
        channelId: interaction.channelId,
        lineupStarted: false,
        locked: false
      };

      games.set(interaction.guildId, game);

      const message = await interaction.reply({
        content: "@everyone",
        embeds: [createActivityEmbed(game)],
        components: createActivityButtons(game),
        allowedMentions: {
          parse: ["everyone"]
        },
        fetchReply: true
      });

      game.messageId = message.id;

      return;
    }

    if (!interaction.isButton()) return;

    const game = games.get(interaction.guildId);

    if (!game) {
      return interaction.reply({
        content:
          "This friendly is no longer active. Start a new `/friendly`.",
        ephemeral: true
      });
    }

    if (interaction.message.id !== game.messageId) {
      return interaction.reply({
        content:
          "This button belongs to an older friendly. Start a new `/friendly`.",
        ephemeral: true
      });
    }

    if (interaction.customId === "can_play") {
      if (game.lineupStarted || game.locked) {
        return interaction.reply({
          content: "The lineup has already started.",
          ephemeral: true
        });
      }

      if (game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "You're already marked as available.",
          ephemeral: true
        });
      }

      game.players.add(interaction.user.id);

      if (game.players.size >= game.needed) {
        game.lineupStarted = true;

        await interaction.update({
          content: "@everyone",
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });
      } else {
        await interaction.update({
          embeds: [createActivityEmbed(game)],
          components: createActivityButtons(game)
        });
      }

      return;
    }

    if (interaction.customId === "cant_play") {
      if (game.lineupStarted || game.locked) {
        return interaction.reply({
          content: "The lineup has already started.",
          ephemeral: true
        });
      }

      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "You're not currently marked as available.",
          ephemeral: true
        });
      }

      game.players.delete(interaction.user.id);

      await interaction.update({
        embeds: [createActivityEmbed(game)],
        components: createActivityButtons(game)
      });

      return;
    }

    if (interaction.customId === "reset_friendly") {
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content: "Only the friendly host can reset it.",
          ephemeral: true
        });
      }

      games.delete(interaction.guildId);

      await interaction.update({
        content: "Friendly cancelled.",
        embeds: [],
        components: []
      });

      return;
    }

    if (interaction.customId.startsWith("position_")) {
      if (!game.lineupStarted) {
        return interaction.reply({
          content: "The lineup isn't ready yet.",
          ephemeral: true
        });
      }

      if (game.locked) {
        return interaction.reply({
          content: "The lineup is locked.",
          ephemeral: true
        });
      }

      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "You didn't mark yourself as available.",
          ephemeral: true
        });
      }

      const position = interaction.customId.replace("position_", "");
      const formation = formations[game.needed];

      if (!formation.positions.includes(position)) {
        return interaction.reply({
          content: "That position doesn't exist.",
          ephemeral: true
        });
      }

      const currentPlayer = game.lineup.get(position);

      if (currentPlayer && currentPlayer !== interaction.user.id) {
        return interaction.reply({
          content: `${position} is already taken.`,
          ephemeral: true
        });
      }

      const oldPosition = getPlayerPosition(game, interaction.user.id);

      if (oldPosition === position) {
        return interaction.reply({
          content: `You're already playing ${position}.`,
          ephemeral: true
        });
      }

      if (oldPosition) {
        game.lineup.delete(oldPosition);
      }

      game.lineup.set(position, interaction.user.id);

      await interaction.update({
        embeds: [createLineupEmbed(game)],
        components: createLineupButtons(game)
      });

      return;
    }

    if (interaction.customId === "lock_lineup") {
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content: "Only the friendly host can lock the lineup.",
          ephemeral: true
        });
      }

      if (game.locked) {
        return interaction.reply({
          content: "The lineup is already locked.",
          ephemeral: true
        });
      }

      const formation = formations[game.needed];

      if (game.lineup.size !== formation.positions.length) {
        return interaction.reply({
          content:
            `The lineup isn't complete yet. ` +
            `${game.lineup.size}/${formation.positions.length} positions filled.`,
          ephemeral: true
        });
      }

      game.locked = true;

      await interaction.update({
        embeds: [createFinalLineupEmbed(game)],
        components: []
      });

      return;
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong. Try again.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

function createActivityButtons(game) {
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

function createActivityEmbed(game) {
  const formation = formations[game.needed];
  const ready = game.players.size >= game.needed;

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Friendly")
    .setDescription(
      `**${game.players.size}/${game.needed} players**\n\n` +
      `Formation: **${formation.name}**\n` +
      `Players: **${game.needed}**\n\n` +
      `🟩 Can play\n` +
      `🟥 Can't play`
    )
    .addFields({
      name: ready ? "Status" : "Activity check",
      value: ready
        ? "Lineup is ready."
        : "React below to confirm your availability.",
      inline: false
    })
    .setFooter({
      text: "Friendly system"
    });
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];

  let description =
    `**${formation.name}** · ${game.lineup.size}/${formation.positions.length} selected\n\n`;

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    description += userId
      ? `**${position}**  <@${userId}>\n`
      : `**${position}**  —\n`;
  }

  description += "\nSelect a position below. You can change your position.";

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Lineup")
    .setDescription(description)
    .setFooter({
      text: "One player per position"
    });
}

function createFinalLineupEmbed(game) {
  const formation = formations[game.needed];

  let description = `**${formation.name}**\n\n`;

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    description += `**${position}**  <@${userId}>\n`;
  }

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Lineup Locked")
    .setDescription(description)
    .setFooter({
      text: "Friendly system"
    });
}

function createLineupButtons(game) {
  const formation = formations[game.needed];
  const rows = [];

  let row = new ActionRowBuilder();

  for (const position of formation.positions) {
    const taken = game.lineup.has(position);

    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(position)
      .setStyle(taken ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(taken);

    row.addComponents(button);

    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }

  if (row.components.length > 0) {
    rows.push(row);
  }

  const complete =
    game.lineup.size === formation.positions.length;

  const lockRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lock_lineup")
      .setLabel(complete ? "LOCK LINEUP" : `LOCK ${game.lineup.size}/${formation.positions.length}`)
      .setStyle(
        complete
          ? ButtonStyle.Success
          : ButtonStyle.Secondary
      )
      .setDisabled(!complete)
  );

  rows.push(lockRow);

  return rows;
}

function getPlayerPosition(game, userId) {
  for (const [position, playerId] of game.lineup) {
    if (playerId === userId) {
      return position;
    }
  }

  return null;
}

client.login(process.env.TOKEN);
