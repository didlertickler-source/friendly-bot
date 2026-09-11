const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const games = new Map();
const PREFIX = "?";

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
    positions: ["GK", "LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW"]
  },
  11: {
    name: "4-3-3",
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
  console.log(`${client.user.tag} is online.`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [command.toJSON()]
      }
    );

    console.log("Slash command registered.");
  } catch (error) {
    console.error("Slash registration error:", error);
  }
});

function getGame(guildId) {
  return games.get(guildId);
}

function createActivityEmbed(game) {
  const formation = formations[game.needed];

  const players = [...game.players];

  return new EmbedBuilder()
    .setTitle("FRIENDLY ACTIVITY CHECK")
    .setDescription(
      `**Players:** ${players.length}/${game.needed}\n` +
      `**Formation:** ${formation.name}\n\n` +
      (
        players.length
          ? players.map(id => `> <@${id}>`).join("\n")
          : "> No players yet."
      )
    )
    .setFooter({
      text: "Click CAN PLAY if you are available."
    });
}

function activityButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("friendly_play")
      .setLabel("CAN PLAY")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("friendly_no")
      .setLabel("CAN'T PLAY")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("friendly_reset")
      .setLabel("RESET")
      .setStyle(ButtonStyle.Secondary)
  );
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];

  let text = "";

  for (const position of formation.positions) {
    const player = game.lineup.get(position);

    text += `**${position}**\n`;
    text += player ? `> <@${player}>\n\n` : "> `OPEN`\n\n";
  }

  return new EmbedBuilder()
    .setTitle(`LINEUP • ${formation.name}`)
    .setDescription(text)
    .setFooter({
      text: game.locked
        ? "LINEUP LOCKED"
        : game.subMode
          ? "SUB MODE • Select a player to replace"
          : "Select a position to join the lineup."
    });
}

function createLineupButtons(game) {
  const formation = formations[game.needed];
  const rows = [];

  let currentRow = [];

  for (const position of formation.positions) {
    const player = game.lineup.get(position);

    const button = new ButtonBuilder()
      .setCustomId(`position_${position}`)
      .setLabel(player ? `${position} • ${game.lineup.get(position) === player ? "FILLED" : ""}` : position)
      .setStyle(
        game.subMode && player
          ? ButtonStyle.Danger
          : player
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
      );

    currentRow.push(button);

    if (currentRow.length === 5) {
      rows.push(new ActionRowBuilder().addComponents(currentRow));
      currentRow = [];
    }
  }

  if (currentRow.length) {
    rows.push(new ActionRowBuilder().addComponents(currentRow));
  }

  if (!game.locked) {
    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sub_mode")
        .setLabel(game.subMode ? "CANCEL SUB" : "SUB")
        .setStyle(game.subMode ? ButtonStyle.Danger : ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("lock_lineup")
        .setLabel("LOCK LINEUP")
        .setStyle(ButtonStyle.Success)
    );

    rows.push(controlRow);
  }

  return rows;
}

client.on("messageDelete", message => {
  for (const [guildId, game] of games) {
    if (
      message.id === game.activityMessageId ||
      message.id === game.lineupMessageId
    ) {
      games.delete(guildId);
      console.log("Friendly removed because a system message was deleted.");
      break;
    }
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const commandName = args.shift()?.toLowerCase();

  if (!commandName) return;

  try {
    if (commandName === "help" || commandName === "commands") {
      const embed = new EmbedBuilder()
        .setTitle("BOT COMMANDS")
        .setDescription(
          [
            "**FRIENDLY**",
            "`/friendly <players>` — start a friendly",
            "",
            "**MODERATION**",
            "`?purge <amount>` — delete messages",
            "`?clear <amount>` — delete messages",
            "`?kick @user [reason]` — kick a member",
            "`?ban @user [reason]` — ban a member",
            "`?unban <userID>` — unban a user",
            "`?timeout @user <minutes>` — timeout a member",
            "`?untimeout @user` — remove timeout",
            "`?warn @user [reason]` — warn a member",
            "`?lock` — lock the channel",
            "`?unlock` — unlock the channel",
            "`?slowmode <seconds>` — set slowmode",
            "",
            "**SERVER**",
            "`?teamrank XI` — show Starting XI",
            "`?membercount` — show member count",
            "`?serverinfo` — server information",
            "`?userinfo [@user]` — user information",
            "`?avatar [@user]` — show avatar",
            "",
            "**UTILITY**",
            "`?ping` — bot latency",
            "`?say <message>` — send a message",
            "`?announce <message>` — announcement",
            "`?poll <question>` — create a poll",
            "`?botinfo` — bot information"
          ].join("\n")
        )
        .setColor(0x111111);

      return message.reply({ embeds: [embed] });
    }

    if (commandName === "purge" || commandName === "clear") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply("You need **Manage Messages**.");
      }

      const amount = parseInt(args[0]);

      if (!amount || amount < 1 || amount > 100) {
        return message.reply("Use an amount between **1 and 100**.");
      }

      try {
        const deleted = await message.channel.bulkDelete(amount + 1, true);

        const msg = await message.channel.send(
          `Deleted **${Math.max(deleted.size - 1, 0)}** messages.`
        );

        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 3000);
      } catch {
        return message.reply(
          "I couldn't delete those messages. Messages older than 14 days cannot be bulk deleted."
        );
      }

      return;
    }

    if (commandName === "teamrank") {
      const rank = args.join(" ").toLowerCase();

      if (!rank) {
        return message.reply(
          "Use `?teamrank XI`."
        );
      }

      if (rank !== "xi" && rank !== "starting xi" && rank !== "main") {
        return message.reply(
          "Available rank: `XI`"
        );
      }

      const roleName = "〔✦〕STARTING XI/MAIN PLAYERS";

      const role = message.guild.roles.cache.find(
        r => r.name === roleName
      );

      if (!role) {
        return message.reply(
          `I couldn't find the role **${roleName}**.`
        );
      }

      await message.guild.members.fetch();

      const members = role.members;

      if (!members.size) {
        return message.reply(
          `Nobody currently has the **${roleName}** role.`
        );
      }

      const sortedMembers = [...members.values()]
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        );

      const playerList = sortedMembers
        .map(
          (member, index) =>
            `**${index + 1}.** <@${member.id}>`
        )
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("STARTING XI")
        .setDescription(
          `**Rank:** XI\n` +
          `**Players:** ${members.size}\n\n` +
          playerList
        )
        .setFooter({
          text: roleName
        })
        .setColor(0x111111);

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (commandName === "kick") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.KickMembers
        )
      ) {
        return message.reply("You need **Kick Members**.");
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply("Mention someone to kick.");
      }

      if (!member.kickable) {
        return message.reply(
          "I can't kick that member. Check my role hierarchy and permissions."
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.kick(reason);

      return message.reply(
        `Kicked **${member.user.tag}**.`
      );
    }

    if (commandName === "ban") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {
        return message.reply("You need **Ban Members**.");
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply("Mention someone to ban.");
      }

      if (!member.bannable) {
        return message.reply(
          "I can't ban that member. Check my role hierarchy and permissions."
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.ban({ reason });

      return message.reply(
        `Banned **${member.user.tag}**.`
      );
    }

    if (commandName === "unban") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {
        return message.reply("You need **Ban Members**.");
      }

      const userId = args[0];

      if (!userId) {
        return message.reply(
          "Use `?unban <userID>`."
        );
      }

      await message.guild.members.unban(userId);

      return message.reply(
        `Unbanned **${userId}**.`
      );
    }

    if (commandName === "timeout") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply("You need **Moderate Members**.");
      }

      const member =
        message.mentions.members.first();

      const minutes = parseInt(args[1]);

      if (!member || !minutes || minutes < 1) {
        return message.reply(
          "Use `?timeout @user <minutes>`."
        );
      }

      if (!member.moderatable) {
        return message.reply(
          "I can't timeout that member."
        );
      }

      await member.timeout(
        minutes * 60 * 1000,
        "Timed out by moderator"
      );

      return message.reply(
        `Timed out **${member.user.tag}** for **${minutes} minutes**.`
      );
    }

    if (commandName === "untimeout") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply("You need **Moderate Members**.");
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Use `?untimeout @user`."
        );
      }

      await member.timeout(null);

      return message.reply(
        `Removed timeout from **${member.user.tag}**.`
      );
    }

    if (commandName === "warn") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply("You need **Moderate Members**.");
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Use `?warn @user [reason]`."
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      return message.channel.send(
        `**Warning issued**\n<@${member.id}>\nReason: **${reason}**`
      );
    }

    if (commandName === "slowmode") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply("You need **Manage Channels**.");
      }

      const seconds = parseInt(args[0]);

      if (
        isNaN(seconds) ||
        seconds < 0 ||
        seconds > 21600
      ) {
        return message.reply(
          "Use a value between **0 and 21600** seconds."
        );
      }

      await message.channel.setRateLimitPerUser(seconds);

      return message.reply(
        `Slowmode set to **${seconds}s**.`
      );
    }

    if (commandName === "lock") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply("You need **Manage Channels**.");
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: false
        }
      );

      return message.reply("Channel locked.");
    }

    if (commandName === "unlock") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply("You need **Manage Channels**.");
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: null
        }
      );

      return message.reply("Channel unlocked.");
    }

    if (commandName === "ping") {
      return message.reply(
        `Pong **${client.ws.ping}ms**.`
      );
    }

    if (commandName === "userinfo") {
      const member =
        message.mentions.members.first() ||
        message.member;

      const roles = member.roles.cache
        .filter(role => role.id !== message.guild.id)
        .map(role => role.toString())
        .join(", ") || "None";

      const embed = new EmbedBuilder()
        .setTitle("USER INFORMATION")
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          {
            name: "User",
            value: member.user.tag,
            inline: true
          },
          {
            name: "ID",
            value: member.id,
            inline: true
          },
          {
            name: "Joined",
            value: `<t:${Math.floor(
              member.joinedTimestamp / 1000
            )}:R>`,
            inline: true
          },
          {
            name: "Roles",
            value: roles.slice(0, 1024)
          }
        )
        .setColor(0x111111);

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (commandName === "serverinfo") {
      const owner = await message.guild.fetchOwner();

      const embed = new EmbedBuilder()
        .setTitle("SERVER INFORMATION")
        .addFields(
          {
            name: "Server",
            value: message.guild.name,
            inline: true
          },
          {
            name: "Members",
            value: `${message.guild.memberCount}`,
            inline: true
          },
          {
            name: "Channels",
            value: `${message.guild.channels.cache.size}`,
            inline: true
          },
          {
            name: "Roles",
            value: `${message.guild.roles.cache.size}`,
            inline: true
          },
          {
            name: "Owner",
            value: `<@${owner.id}>`,
            inline: true
          },
          {
            name: "Created",
            value: `<t:${Math.floor(
              message.guild.createdTimestamp / 1000
            )}:R>`,
            inline: true
          }
        )
        .setColor(0x111111);

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (commandName === "avatar") {
      const user =
        message.mentions.users.first() ||
        message.author;

      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Avatar`)
        .setImage(user.displayAvatarURL({ size: 1024 }))
        .setColor(0x111111);

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (commandName === "say") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply("You need **Manage Messages**.");
      }

      const text = args.join(" ");

      if (!text) {
        return message.reply(
          "Use `?say <message>`."
        );
      }

      await message.delete().catch(() => {});

      return message.channel.send(text);
    }

    if (commandName === "announce") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply("You need **Manage Messages**.");
      }

      const text = args.join(" ");

      if (!text) {
        return message.reply(
          "Use `?announce <message>`."
        );
      }

      const embed = new EmbedBuilder()
        .setTitle("ANNOUNCEMENT")
        .setDescription(text)
        .setFooter({
          text: `Posted by ${message.author.tag}`
        })
        .setColor(0x111111);

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (commandName === "poll") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply("You need **Manage Messages**.");
      }

      const question = args.join(" ");

      if (!question) {
        return message.reply(
          "Use `?poll <question>`."
        );
      }

      const embed = new EmbedBuilder()
        .setTitle("POLL")
        .setDescription(question)
        .setFooter({
          text: `Poll by ${message.author.tag}`
        })
        .setColor(0x111111);

      const poll = await message.channel.send({
        embeds: [embed]
      });

      await poll.react("👍");
      await poll.react("👎");

      return;
    }

    if (commandName === "membercount") {
      return message.reply(
        `This server has **${message.guild.memberCount}** members.`
      );
    }

    if (commandName === "botinfo") {
      const uptime = Math.floor(
        client.uptime / 1000
      );

      return message.reply(
        `**${client.user.tag}**\n` +
        `Servers: **${client.guilds.cache.size}**\n` +
        `Ping: **${client.ws.ping}ms**\n` +
        `Uptime: **${uptime}s**`
      );
    }
  } catch (error) {
    console.error("Prefix command error:", error);

    return message.reply(
      "Something went wrong while running that command."
    ).catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "friendly") return;

      const guildId = interaction.guildId;

      const oldGame = games.get(guildId);

      if (oldGame) {
        let oldActivityExists = false;
        let oldLineupExists = false;

        try {
          await interaction.channel.messages.fetch(
            oldGame.activityMessageId
          );
          oldActivityExists = true;
        } catch {}

        if (oldGame.lineupMessageId) {
          try {
            await interaction.channel.messages.fetch(
              oldGame.lineupMessageId
            );
            oldLineupExists = true;
          } catch {}
        }

        if (oldActivityExists || oldLineupExists) {
          return interaction.reply({
            content:
              "There is already an active friendly in this server.",
            ephemeral: true
          });
        }

        games.delete(guildId);
      }

      const needed =
        interaction.options.getInteger("players");

      const game = {
        hostId: interaction.user.id,
        needed,
        channelId: interaction.channelId,
        activityMessageId: null,
        lineupMessageId: null,
        players: new Set(),
        lineup: new Map(),
        lineupStarted: false,
        locked: false,
        subMode: false
      };

      games.set(guildId, game);

      const formation = formations[needed];

      const activity = await interaction.channel.send({
        content: "@everyone",
        embeds: [createActivityEmbed(game)],
        components: [activityButtons(game)]
      });

      game.activityMessageId = activity.id;

      await interaction.reply({
        content: "Friendly created.",
        ephemeral: true
      });

      return;
    }

    if (!interaction.isButton()) return;

    const game = games.get(interaction.guildId);

    if (!game) {
      return interaction.reply({
        content: "This friendly is no longer active.",
        ephemeral: true
      });
    }

    if (
      interaction.message.id !== game.activityMessageId &&
      interaction.message.id !== game.lineupMessageId
    ) {
      return interaction.reply({
        content: "This friendly is no longer active.",
        ephemeral: true
      });
    }

    if (interaction.customId === "friendly_play") {
      game.players.add(interaction.user.id);

      const activity =
        await interaction.channel.messages.fetch(
          game.activityMessageId
        );

      await activity.edit({
        embeds: [createActivityEmbed(game)],
        components: [activityButtons(game)]
      });

      if (
        game.players.size >= game.needed &&
        !game.lineupStarted
      ) {
        game.lineupStarted = true;

        const lineup =
          await interaction.channel.send({
            embeds: [createLineupEmbed(game)],
            components: createLineupButtons(game)
          });

        game.lineupMessageId = lineup.id;
      }

      return interaction.reply({
        content: "You are marked as available.",
        ephemeral: true
      });
    }

    if (interaction.customId === "friendly_no") {
      game.players.delete(interaction.user.id);

      for (const [position, playerId] of game.lineup) {
        if (playerId === interaction.user.id) {
          game.lineup.delete(position);
        }
      }

      const activity =
        await interaction.channel.messages.fetch(
          game.activityMessageId
        );

      await activity.edit({
        embeds: [createActivityEmbed(game)],
        components: [activityButtons(game)]
      });

      if (game.lineupMessageId) {
        try {
          const lineup =
            await interaction.channel.messages.fetch(
              game.lineupMessageId
            );

          await lineup.edit({
            embeds: [createLineupEmbed(game)],
            components: createLineupButtons(game)
          });
        } catch {}
      }

      return interaction.reply({
        content: "You are marked as unavailable.",
        ephemeral: true
      });
    }

    if (interaction.customId === "friendly_reset") {
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content: "Only the host can reset the friendly.",
          ephemeral: true
        });
      }

      game.players.clear();
      game.lineup.clear();
      game.lineupStarted = false;
      game.locked = false;
      game.subMode = false;

      const activity =
        await interaction.channel.messages.fetch(
          game.activityMessageId
        );

      await activity.edit({
        embeds: [createActivityEmbed(game)],
        components: [activityButtons(game)]
      });

      if (game.lineupMessageId) {
        try {
          const lineup =
            await interaction.channel.messages.fetch(
              game.lineupMessageId
            );

          await lineup.delete();
        } catch {}
      }

      game.lineupMessageId = null;

      return interaction.reply({
        content: "Friendly reset.",
        ephemeral: true
      });
    }

    if (interaction.customId === "sub_mode") {
      if (game.locked) {
        return interaction.reply({
          content: "The lineup is locked.",
          ephemeral: true
        });
      }

      game.subMode = !game.subMode;

      await interaction.message.edit({
        embeds: [createLineupEmbed(game)],
        components: createLineupButtons(game)
      });

      return interaction.reply({
        content: game.subMode
          ? "SUB mode enabled."
          : "SUB mode disabled.",
        ephemeral: true
      });
    }

    if (interaction.customId === "lock_lineup") {
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({
          content: "Only the host can lock the lineup.",
          ephemeral: true
        });
      }

      if (game.lineup.size < game.needed) {
        return interaction.reply({
          content: "Every position must be filled first.",
          ephemeral: true
        });
      }

      game.locked = true;
      game.subMode = false;

      await interaction.message.edit({
        embeds: [createLineupEmbed(game)],
        components: []
      });

      return interaction.reply({
        content: "Lineup locked.",
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("position_")) {
      if (game.locked) {
        return interaction.reply({
          content: "The lineup is locked.",
          ephemeral: true
        });
      }

      const position =
        interaction.customId.replace("position_", "");

      const currentPlayer =
        game.lineup.get(position);

      if (game.subMode) {
        if (!currentPlayer) {
          return interaction.reply({
            content: "That position is empty.",
            ephemeral: true
          });
        }

        if (currentPlayer === interaction.user.id) {
          return interaction.reply({
            content: "You can't sub yourself.",
            ephemeral: true
          });
        }

        game.lineup.set(
          position,
          interaction.user.id
        );

        game.players.add(interaction.user.id);
        game.subMode = false;

        await interaction.message.edit({
          embeds: [createLineupEmbed(game)],
          components: createLineupButtons(game)
        });

        return interaction.reply({
          content: `You replaced <@${currentPlayer}> at **${position}**.`,
          ephemeral: true
        });
      }

      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({
          content: "You must click CAN PLAY first.",
          ephemeral: true
        });
      }

      if (currentPlayer) {
        if (currentPlayer === interaction.user.id) {
          game.lineup.delete(position);

          await interaction.message.edit({
            embeds: [createLineupEmbed(game)],
            components: createLineupButtons(game)
          });

          return interaction.reply({
            content: `You left **${position}**.`,
            ephemeral: true
          });
        }

        return interaction.reply({
          content: `**${position}** is already taken.`,
          ephemeral: true
        });
      }

      for (const [
        oldPosition,
        playerId
      ] of game.lineup) {
        if (playerId === interaction.user.id) {
          game.lineup.delete(oldPosition);
        }
      }

      game.lineup.set(
        position,
        interaction.user.id
      );

      await interaction.message.edit({
        embeds: [createLineupEmbed(game)],
        components: createLineupButtons(game)
      });

      return interaction.reply({
        content: `You are now **${position}**.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
