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

client.on("messageDelete", message => {
  for (const [guildId, game] of games) {
    if (game.messageId === message.id) {
      games.delete(guildId);
      console.log(`Friendly removed because its message was deleted.`);
    }
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

      if (games.has(interaction.guildId)) {
        const game = games.get(interaction.guildId);

        try {
          const channel = await client.channels.fetch(game.channelId);
          await channel.messages.fetch(game.messageId);
        } catch {
          games.delete(interaction.guildId);
        }
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
        locked: false,
        subMode: false
      };

      games.set(interaction.guildId, game);

      const message = await interaction.reply({
        content: "@everyone",
        embeds: [createActivityEmbed(game)],
        components: createActivityButtons(),
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
        content: "This friendly is no longer active. Start a new `/friendly`.",
        ephemeral: true
      });
    }

    if (interaction.message.id !== game.messageId) {
      return interaction.reply({
        content: "This friendly message is no longer active.",
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
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });
      } else {
        await interaction.update({
          embeds: [createActivityEmbed(game)],
          components: createActivityButtons()
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

      game.players.delete(interaction.user.id);

      await interaction.update({
        embeds: [createActivityEmbed(game)],
        components: createActivityButtons()
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

    if (interaction.customId === "sub_mode") {
      if (!game.lineupStarted) {
        return interaction.reply({
          content: "The lineup hasn't started yet.",
          ephemeral: true
        });
      }

      if (game.locked) {
        return interaction.reply({
          content: "The lineup is locked.",
          ephemeral: true
        });
      }

      game.subMode = true;

      await interaction.update({
        embeds: [createSubEmbed(game)],
        components: createSubButtons(game)
      });

      return;
    }

    if (interaction.customId === "cancel_sub") {
      game.subMode = false;

      await interaction.update({
        embeds: [createLineupEmbed(game)],
        components: createLineupButtons(game)
      });

      return;
    }

    if (interaction.customId.startsWith("position_")) {
      if (!game.lineupStarted || game.locked) {
        return interaction.reply({
          content: "You can't change the lineup right now.",
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

      if (game.subMode) {
        const currentPlayer = game.lineup.get(position);

        if (!currentPlayer) {
          return interaction.reply({
            content: "You can only substitute an existing player.",
            ephemeral: true
          });
        }

        if (currentPlayer === interaction.user.id) {
          return interaction.reply({
            content: "You can't substitute yourself.",
            ephemeral: true
          });
        }

        game.lineup.set(position, interaction.user.id);
        game.players.add(interaction.user.id);
        game.subMode = false;

        await interaction.update({
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });

        return;
      }

      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "You didn't mark yourself as available.",
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
      game.subMode = false;

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

function createActivityEmbed(game) {
  const formation = formations[game.needed];

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Friendly")
    .setDescription(
      `**${game.players.size}/${game.needed} players**\n\n` +
      `Formation: **${formation.name}**\n\n` +
      `🟩 Can play\n` +
      `🟥 Can't play`
    )
    .setFooter({
      text: "Friendly system"
    });
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];

  let description =
    `**${formation.name}** · ${game.lineup.size}/${formation.positions.length}\n\n`;

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    description += userId
      ? `**${position}**  <@${userId}>\n`
      : `**${position}**  —\n`;
  }

  description += "\nSelect your position or use **SUB** to replace a player.";

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Lineup")
    .setDescription(description)
    .setFooter({
      text: "One player per position"
    });
}

function createSubEmbed(game) {
  const formation = formations[game.needed];

  let description =
    `**Substitution** · choose a player to replace\n\n`;

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    if (userId) {
      description += `**${position}**  <@${userId}>\n`;
    }
  }

  description += "\nChoose the position you want to replace.";

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Substitution")
    .setDescription(description)
    .setFooter({
      text: "Select a position to make a substitution"
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

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sub_mode")
        .setLabel("SUB")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("lock_lineup")
        .setLabel(
          complete
            ? "LOCK LINEUP"
            : `LOCK ${game.lineup.size}/${formation.positions.length}`
        )
        .setStyle(
          complete
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
        .setDisabled(!complete)
    )
  );

  return rows;
}

function createSubButtons(game) {
  const formation = formations[game.needed];
  const rows = [];

  let row = new ActionRowBuilder();

  for (const position of formation.positions) {
    const taken = game.lineup.has(position);

    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(position)
      .setStyle(taken ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(!taken);

    row.addComponents(button);

    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  }

  if (row.components.length > 0) {
    rows.push(row);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cancel_sub")
        .setLabel("CANCEL")
        .setStyle(ButtonStyle.Secondary)
    )
  );

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
