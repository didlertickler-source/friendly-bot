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
    positions: ["GK", "LB", "RB", "CAM", "LW", "ST"]
  },

  7: {
    name: "3-1-2",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST"]
  },

  8: {
    name: "3-1-3",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST", "RW"]
  },

  9: {
    name: "3-2-3",
    positions: [
      "GK",
      "LB",
      "CB",
      "RB",
      "LCM",
      "RCM",
      "LW",
      "ST",
      "RW"
    ]
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

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [command.toJSON()]
      }
    );

    console.log("Friendly system loaded.");
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "friendly") return;

      const needed = interaction.options.getInteger("players");

      if (games.has(interaction.guildId)) {
        return interaction.reply({
          content:
            "❌ **There is already an active friendly in this server.**",
          ephemeral: true
        });
      }

      const formation = formations[needed];

      const game = {
        hostId: interaction.user.id,
        needed,
        players: new Set(),
        lineup: new Map(),
        channelId: interaction.channelId,
        activityMessageId: null,
        lineupMessageId: null,
        lineupStarted: false,
        locked: false
      };

      games.set(interaction.guildId, game);

      const message = await interaction.reply({
        content: "@everyone",
        embeds: [createActivityEmbed(game, formation)],
        components: createActivityButtons(),
        allowedMentions: {
          parse: ["everyone"]
        },
        fetchReply: true
      });

      game.activityMessageId = message.id;

      return;
    }

    if (!interaction.isButton()) return;

    const game = games.get(interaction.guildId);

    if (!game) {
      return interaction.reply({
        content:
          "❌ **This friendly is no longer active.**\n\n" +
          "The bot was restarted while this friendly was running. " +
          "Start a new `/friendly` to create a fresh match.",
        ephemeral: true
      });
    }

    if (game.locked) {
      return interaction.reply({
        content: "🔒 **This lineup is already locked.**",
        ephemeral: true
      });
    }

    if (interaction.customId === "can_play") {
      if (game.lineupStarted) {
        return interaction.reply({
          content:
            "❌ **The lineup has already started.**\n" +
            "You can't change availability now.",
          ephemeral: true
        });
      }

      if (game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "🟩 **You're already marked as available.**",
          ephemeral: true
        });
      }

      game.players.add(interaction.user.id);

      await updateActivity(interaction);

      if (game.players.size >= game.needed && !game.lineupStarted) {
        await createLineup(interaction);
      }

      return;
    }

    if (interaction.customId === "cant_play") {
      if (game.lineupStarted) {
        return interaction.reply({
          content:
            "❌ **The lineup has already started.**\n" +
            "You can't change availability now.",
          ephemeral: true
        });
      }

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
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content:
            "❌ **Only the friendly host can reset the match.**",
          ephemeral: true
        });
      }

      games.delete(interaction.guildId);

      return interaction.update({
        content: "🛑 **FRIENDLY CANCELLED**",
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("position_")) {
      if (!game.lineupStarted) {
        return interaction.reply({
          content:
            "❌ **The lineup isn't ready yet.**",
          ephemeral: true
        });
      }

      const position = interaction.customId.replace(
        "position_",
        ""
      );

      const formation = formations[game.needed];

      if (!formation.positions.includes(position)) {
        return interaction.reply({
          content: "❌ **Invalid position.**",
          ephemeral: true
        });
      }

      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({
          content:
            "❌ **You didn't mark yourself as available.**",
          ephemeral: true
        });
      }

      const currentPosition = getPlayerPosition(
        game,
        interaction.user.id
      );

      if (currentPosition === position) {
        return interaction.reply({
          content:
            `ℹ️ You're already playing **${position}**.`,
          ephemeral: true
        });
      }

      if (game.lineup.has(position)) {
        return interaction.reply({
          content:
            `❌ **${position}** is already taken.`,
          ephemeral: true
        });
      }

      if (currentPosition) {
        game.lineup.delete(currentPosition);
      }

      game.lineup.set(position, interaction.user.id);

      await updateLineup(interaction);

      return interaction.reply({
        content:
          `✅ You're now playing **${position}**.`,
        ephemeral: true
      });
    }

    if (interaction.customId === "lock_lineup") {
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content:
            "❌ **Only the friendly host can lock the lineup.**",
          ephemeral: true
        });
      }

      const formation = formations[game.needed];

      if (game.lineup.size < formation.positions.length) {
        return interaction.reply({
          content:
            `❌ **The lineup isn't full yet.**\n\n` +
            `**${game.lineup.size}/${formation.positions.length}** positions filled.`,
          ephemeral: true
        });
      }

      game.locked = true;

      const message =
        await interaction.channel.messages.fetch(
          game.lineupMessageId
        );

      await message.edit({
        content:
          "━━━━━━━━━━━━━━━━━━━━\n" +
          "**🔒 LINEUP LOCKED**\n" +
          "━━━━━━━━━━━━━━━━━━━━",
        embeds: [
          createFinalLineupEmbed(game, formation)
        ],
        components: []
      });

      return interaction.reply({
        content:
          "🔒 **Lineup locked successfully.**",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          "❌ **Something went wrong.** Check the Railway logs.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

function createActivityButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("can_play")
        .setLabel("CAN PLAY")
        .setEmoji("🟩")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("cant_play")
        .setLabel("CAN'T PLAY")
        .setEmoji("🟥")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("reset_friendly")
        .setLabel("RESET")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createActivityEmbed(game, formation) {
  const count = game.players.size;

  const status =
    count >= game.needed
      ? "🟢 **READY FOR LINEUP**"
      : `🟡 **${count}/${game.needed} READY**`;

  return new EmbedBuilder()
    .setColor(0x151515)
    .setTitle("⚽  FRIENDLY MATCH")
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "**ACTIVITY CHECK**\n" +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      `${status}\n\n` +
      `👥 **Players:** \`${count}/${game.needed}\`\n` +
      `📐 **Formation:** \`${formation.name}\`\n\n` +
      "🟩 **CAN PLAY**\n" +
      "Click if you're available.\n\n" +
      "🟥 **CAN'T PLAY**\n" +
      "Click if you can't play.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━"
    )
    .addFields({
      name: "HOST",
      value: `<@${game.hostId}>`,
      inline: true
    })
    .addFields({
      name: "STATUS",
      value: count >= game.needed
        ? "READY"
        : "WAITING",
      inline: true
    })
    .setFooter({
      text: "Friendly System • Activity Check"
    });
}

async function updateActivity(interaction) {
  const game = games.get(interaction.guildId);

  if (!game || !game.activityMessageId) return;

  const formation = formations[game.needed];

  const message =
    await interaction.channel.messages.fetch(
      game.activityMessageId
    );

  await message.edit({
    embeds: [
      createActivityEmbed(game, formation)
    ],
    components: createActivityButtons(
      game.lineupStarted
    )
  });

  if (
    !interaction.replied &&
    !interaction.deferred
  ) {
    await interaction.deferUpdate();
  }
}

async function createLineup(interaction) {
  const game = games.get(interaction.guildId);

  if (!game || game.lineupMessageId) return;

  game.lineupStarted = true;

  const formation = formations[game.needed];

  const activityMessage =
    await interaction.channel.messages.fetch(
      game.activityMessageId
    );

  await activityMessage.edit({
    embeds: [
      createActivityEmbed(game, formation)
    ],
    components: createActivityButtons(true)
  });

  const message =
    await interaction.channel.send({
      content:
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "**⚽ LINEUP READY**\n" +
        "━━━━━━━━━━━━━━━━━━━━",
      embeds: [
        createLineupEmbed(game, formation)
      ],
      components: createPositionButtons(
        game,
        formation
      )
    });

  game.lineupMessageId = message.id;
}

function createLineupEmbed(game, formation) {
  let lineup = "";

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    lineup += userId
      ? `**${position}**  →  <@${userId}>\n`
      : `**${position}**  →  \`OPEN\`\n`;
  }

  const filled = game.lineup.size;
  const total = formation.positions.length;

  return new EmbedBuilder()
    .setColor(0x151515)
    .setTitle("⚽  MATCH LINEUP")
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `**FORMATION  ${formation.name}**\n` +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      lineup +
      "\n━━━━━━━━━━━━━━━━━━━━"
    )
    .addFields({
      name: "POSITIONS",
      value: `\`${filled}/${total}\` filled`,
      inline: true
    })
    .addFields({
      name: "FORMATION",
      value: `\`${formation.name}\``,
      inline: true
    })
    .setFooter({
      text:
        "Select one position • Host can lock the lineup"
    });
}

function createPositionButtons(game, formation) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const position of formation.positions) {
    const taken = game.lineup.has(position);

    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(
        taken
          ? `✓ ${position}`
          : position
      )
      .setStyle(
        taken
          ? ButtonStyle.Secondary
          : ButtonStyle.Primary
      )
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

  const filled =
    game.lineup.size === formation.positions.length;

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lock_lineup")
        .setLabel(
          filled
            ? "LOCK LINEUP"
            : `LOCK (${game.lineup.size}/${formation.positions.length})`
        )
        .setEmoji("🔒")
        .setStyle(
          filled
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
        .setDisabled(!filled)
    )
  );

  return rows;
}

async function updateLineup(interaction) {
  const game = games.get(interaction.guildId);

  if (!game || !game.lineupMessageId) return;

  const formation = formations[game.needed];

  const message =
    await interaction.channel.messages.fetch(
      game.lineupMessageId
    );

  await message.edit({
    embeds: [
      createLineupEmbed(game, formation)
    ],
    components: createPositionButtons(
      game,
      formation
    )
  });
}

function createFinalLineupEmbed(game, formation) {
  let lineup = "";

  for (const position of formation.positions) {
    const userId = game.lineup.get(position);

    lineup +=
      `**${position}**  →  <@${userId}>\n`;
  }

  return new EmbedBuilder()
    .setColor(0x151515)
    .setTitle("🔒  LINEUP LOCKED")
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `**FORMATION  ${formation.name}**\n` +
      "━━━━━━━━━━━━━━━━━━━━\n\n" +
      lineup +
      "\n━━━━━━━━━━━━━━━━━━━━\n" +
      "**⚽ GOOD LUCK — HAVE A GOOD GAME**"
    )
    .addFields({
      name: "PLAYERS",
      value: `\`${formation.positions.length}/${formation.positions.length}\``,
      inline: true
    })
    .addFields({
      name: "STATUS",
      value: "🔒 LOCKED",
      inline: true
    })
    .setFooter({
      text: "Friendly System • Match Ready"
    });
}

function getPlayerPosition(game, userId) {
  for (const [position, id] of game.lineup) {
    if (id === userId) {
      return position;
    }
  }

  return null;
}

client.login(process.env.TOKEN);
