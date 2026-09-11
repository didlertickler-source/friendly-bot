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

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [command.toJSON()]
      }
    );

    console.log("Friendly system loaded.");
    console.log("Prefix system loaded.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

/* =========================
   PREFIX COMMANDS
========================= */

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  try {
    /* ?help */
    if (command === "help" || command === "commands") {
      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle("Bot Commands")
        .setDescription(
          "**Friendly**\n" +
          "`/friendly <players>` — start a friendly\n\n" +

          "**Moderation**\n" +
          "`?purge <amount>` — delete messages\n" +
          "`?kick @user [reason]` — kick a member\n" +
          "`?ban @user [reason]` — ban a member\n" +
          "`?unban <userID>` — unban a user\n" +
          "`?timeout @user <minutes>` — timeout a member\n" +
          "`?untimeout @user` — remove timeout\n" +
          "`?warn @user [reason]` — warn a member\n" +
          "`?slowmode <seconds>` — set channel slowmode\n" +
          "`?lock` — lock the channel\n" +
          "`?unlock` — unlock the channel\n\n" +

          "**Utility**\n" +
          "`?ping` — bot latency\n" +
          "`?userinfo [@user]` — user information\n" +
          "`?serverinfo` — server information\n" +
          "`?avatar [@user]` — show avatar\n" +
          "`?say <message>` — make the bot say something\n" +
          "`?announce <message>` — send an announcement\n" +
          "`?poll <question>` — create a poll\n" +
          "`?membercount` — server member count\n" +
          "`?botinfo` — bot information"
        )
        .setFooter({
          text: "Use ?help anytime"
        });

      return message.reply({
        embeds: [embed]
      });
    }

    /* ?ping */
    if (command === "ping") {
      return message.reply(
        `Pong! **${client.ws.ping}ms**`
      );
    }

    /* ?purge */
    if (command === "purge" || command === "clear") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply("You need **Manage Messages**.");
      }

      const amount = parseInt(args[0]);

      if (!amount || amount < 1 || amount > 100) {
        return message.reply(
          "Use an amount between **1 and 100**."
        );
      }

      try {
        const deleted = await message.channel.bulkDelete(
          amount + 1,
          true
        );

        const msg = await message.channel.send(
          `Deleted **${Math.max(deleted.size - 1, 0)}** messages.`
        );

        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 3000);
      } catch {
        return message.reply(
          "I couldn't delete those messages. They may be older than 14 days."
        );
      }

      return;
    }

    /* ?kick */
    if (command === "kick") {
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
        return message.reply("Usage: `?kick @user [reason]`");
      }

      if (!member.kickable) {
        return message.reply(
          "I can't kick that member."
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.kick(reason);

      return message.reply(
        `Kicked **${member.user.tag}**.\nReason: ${reason}`
      );
    }

    /* ?ban */
    if (command === "ban") {
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
        return message.reply("Usage: `?ban @user [reason]`");
      }

      if (!member.bannable) {
        return message.reply(
          "I can't ban that member."
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.ban({
        reason
      });

      return message.reply(
        `Banned **${member.user.tag}**.\nReason: ${reason}`
      );
    }

    /* ?unban */
    if (command === "unban") {
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
          "Usage: `?unban <userID>`"
        );
      }

      try {
        await message.guild.members.unban(userId);

        return message.reply(
          `Unbanned **${userId}**.`
        );
      } catch {
        return message.reply(
          "That user is not banned or the ID is invalid."
        );
      }
    }

    /* ?timeout */
    if (command === "timeout") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply(
          "You need **Moderate Members**."
        );
      }

      const member =
        message.mentions.members.first();

      const minutes = parseInt(
        args[1]
      );

      if (!member || !minutes) {
        return message.reply(
          "Usage: `?timeout @user <minutes>`"
        );
      }

      if (!member.moderatable) {
        return message.reply(
          "I can't timeout that member."
        );
      }

      if (minutes < 1 || minutes > 40320) {
        return message.reply(
          "Timeout must be between **1 minute and 28 days**."
        );
      }

      await member.timeout(
        minutes * 60 * 1000,
        `Timeout by ${message.author.tag}`
      );

      return message.reply(
        `Timed out **${member.user.tag}** for **${minutes} minutes**.`
      );
    }

    /* ?untimeout */
    if (command === "untimeout") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply(
          "You need **Moderate Members**."
        );
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?untimeout @user`"
        );
      }

      if (!member.moderatable) {
        return message.reply(
          "I can't modify that member."
        );
      }

      await member.timeout(null);

      return message.reply(
        `Removed timeout from **${member.user.tag}**.`
      );
    }

    /* ?warn */
    if (command === "warn") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {
        return message.reply(
          "You need **Moderate Members**."
        );
      }

      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?warn @user [reason]`"
        );
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      return message.reply(
        `⚠️ **${member.user.tag}** has been warned.\nReason: ${reason}`
      );
    }

    /* ?slowmode */
    if (command === "slowmode") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply(
          "You need **Manage Channels**."
        );
      }

      const seconds = parseInt(args[0]);

      if (
        Number.isNaN(seconds) ||
        seconds < 0 ||
        seconds > 21600
      ) {
        return message.reply(
          "Use a value between **0 and 21600 seconds**."
        );
      }

      await message.channel.setRateLimitPerUser(
        seconds
      );

      return message.reply(
        seconds === 0
          ? "Slowmode disabled."
          : `Slowmode set to **${seconds}s**.`
      );
    }

    /* ?lock */
    if (command === "lock") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply(
          "You need **Manage Channels**."
        );
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: false
        }
      );

      return message.reply(
        "Channel locked."
      );
    }

    /* ?unlock */
    if (command === "unlock") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {
        return message.reply(
          "You need **Manage Channels**."
        );
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: null
        }
      );

      return message.reply(
        "Channel unlocked."
      );
    }

    /* ?userinfo */
    if (command === "userinfo") {
      const member =
        message.mentions.members.first() ||
        message.member;

      const roles = member.roles.cache
        .filter(role => role.id !== message.guild.id)
        .map(role => role.name)
        .slice(0, 10)
        .join(", ") || "None";

      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle("User Information")
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          {
            name: "User",
            value: `${member.user.tag}`,
            inline: true
          },
          {
            name: "ID",
            value: member.id,
            inline: true
          },
          {
            name: "Joined",
            value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
            inline: true
          },
          {
            name: "Roles",
            value: roles,
            inline: false
          }
        );

      return message.reply({
        embeds: [embed]
      });
    }

    /* ?serverinfo */
    if (command === "serverinfo") {
      const guild = message.guild;

      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle("Server Information")
        .setThumbnail(
          guild.iconURL({
            size: 1024
          })
        )
        .addFields(
          {
            name: "Name",
            value: guild.name,
            inline: true
          },
          {
            name: "Members",
            value: `${guild.memberCount}`,
            inline: true
          },
          {
            name: "Channels",
            value: `${guild.channels.cache.size}`,
            inline: true
          },
          {
            name: "Roles",
            value: `${guild.roles.cache.size}`,
            inline: true
          },
          {
            name: "Created",
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
            inline: true
          },
          {
            name: "Owner",
            value: `<@${guild.ownerId}>`,
            inline: true
          }
        );

      return message.reply({
        embeds: [embed]
      });
    }

    /* ?avatar */
    if (command === "avatar") {
      const member =
        message.mentions.members.first() ||
        message.member;

      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle(`${member.user.username}'s Avatar`)
        .setImage(
          member.user.displayAvatarURL({
            size: 1024
          })
        );

      return message.reply({
        embeds: [embed]
      });
    }

    /* ?say */
    if (command === "say") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply(
          "You need **Manage Messages**."
        );
      }

      const text = args.join(" ");

      if (!text) {
        return message.reply(
          "Usage: `?say <message>`"
        );
      }

      await message.delete().catch(() => {});

      return message.channel.send({
        content: text
      });
    }

    /* ?announce */
    if (command === "announce") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply(
          "You need **Manage Messages**."
        );
      }

      const text = args.join(" ");

      if (!text) {
        return message.reply(
          "Usage: `?announce <message>`"
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle("Announcement")
        .setDescription(text)
        .setFooter({
          text: `Posted by ${message.author.tag}`
        });

      return message.channel.send({
        embeds: [embed]
      });
    }

    /* ?poll */
    if (command === "poll") {
      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        return message.reply(
          "You need **Manage Messages**."
        );
      }

      const question = args.join(" ");

      if (!question) {
        return message.reply(
          "Usage: `?poll <question>`"
        );
      }

      const pollMessage = await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x18181b)
            .setTitle("Poll")
            .setDescription(question)
            .setFooter({
              text: `Poll by ${message.author.tag}`
            })
        ]
      });

      await pollMessage.react("👍");
      await pollMessage.react("👎");

      return;
    }

    /* ?membercount */
    if (command === "membercount") {
      return message.reply(
        `This server has **${message.guild.memberCount} members**.`
      );
    }

    /* ?botinfo */
    if (command === "botinfo") {
      const uptime = Math.floor(
        client.uptime / 1000
      );

      const days = Math.floor(
        uptime / 86400
      );

      const hours = Math.floor(
        (uptime % 86400) / 3600
      );

      const minutes = Math.floor(
        (uptime % 3600) / 60
      );

      const embed = new EmbedBuilder()
        .setColor(0x18181b)
        .setTitle("Bot Information")
        .setDescription(
          `**Name:** ${client.user.tag}\n` +
          `**Servers:** ${client.guilds.cache.size}\n` +
          `**Ping:** ${client.ws.ping}ms\n` +
          `**Uptime:** ${days}d ${hours}h ${minutes}m`
        )
        .setFooter({
          text: "Friendly System"
        });

      return message.reply({
        embeds: [embed]
      });
    }
  } catch (error) {
    console.error("Prefix command error:", error);

    return message.reply(
      "Something went wrong while running that command."
    ).catch(() => {});
  }
});

/* =========================
   FRIENDLY SYSTEM
========================= */

client.on("messageDelete", message => {
  for (const [guildId, game] of games) {
    if (
      message.id === game.activityMessageId ||
      message.id === game.lineupMessageId
    ) {
      games.delete(guildId);

      console.log(
        "Friendly removed because a system message was deleted."
      );

      break;
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

      const needed =
        interaction.options.getInteger("players");

      if (games.has(interaction.guildId)) {
        const oldGame =
          games.get(interaction.guildId);

        let valid = false;

        try {
          const channel =
            await client.channels.fetch(
              oldGame.channelId
            );

          await channel.messages.fetch(
            oldGame.activityMessageId
          );

          valid = true;
        } catch {}

        if (
          oldGame.lineupMessageId &&
          valid
        ) {
          try {
            const channel =
              await client.channels.fetch(
                oldGame.channelId
              );

            await channel.messages.fetch(
              oldGame.lineupMessageId
            );
          } catch {
            valid = false;
          }
        }

        if (!valid) {
          games.delete(
            interaction.guildId
          );
        }
      }

      if (games.has(interaction.guildId)) {
        return interaction.reply({
          content:
            "There is already a friendly running in this server.",
          ephemeral: true
        });
      }

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

      games.set(
        interaction.guildId,
        game
      );

      const msg =
        await interaction.reply({
          content: "@everyone",
          embeds: [
            createActivityEmbed(game)
          ],
          components:
            createActivityButtons(),
          allowedMentions: {
            parse: ["everyone"]
          },
          fetchReply: true
        });

      game.activityMessageId =
        msg.id;

      return;
    }

    if (!interaction.isButton()) return;

    const game =
      games.get(interaction.guildId);

    if (!game) {
      return interaction.reply({
        content:
          "This friendly is no longer active. Start a new `/friendly`.",
        ephemeral: true
      });
    }

    const isActivity =
      interaction.message.id ===
      game.activityMessageId;

    const isLineup =
      interaction.message.id ===
      game.lineupMessageId;

    if (!isActivity && !isLineup) {
      return interaction.reply({
        content:
          "This friendly message is no longer active.",
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "can_play"
    ) {
      if (
        game.lineupStarted ||
        game.locked
      ) {
        return interaction.reply({
          content:
            "The lineup has already started.",
          ephemeral: true
        });
      }

      if (
        game.players.has(
          interaction.user.id
        )
      ) {
        return interaction.reply({
          content:
            "You're already marked as available.",
          ephemeral: true
        });
      }

      game.players.add(
        interaction.user.id
      );

      if (
        game.players.size >=
        game.needed
      ) {
        game.lineupStarted = true;

        await interaction.update({
          embeds: [
            createActivityEmbed(game)
          ],
          components:
            createActivityButtons()
        });

        await createLineupMessage(
          interaction,
          game
        );
      } else {
        await interaction.update({
          embeds: [
            createActivityEmbed(game)
          ],
          components:
            createActivityButtons()
        });
      }

      return;
    }

    if (
      interaction.customId ===
      "cant_play"
    ) {
      if (
        game.lineupStarted ||
        game.locked
      ) {
        return interaction.reply({
          content:
            "The lineup has already started.",
          ephemeral: true
        });
      }

      game.players.delete(
        interaction.user.id
      );

      await interaction.update({
        embeds: [
          createActivityEmbed(game)
        ],
        components:
          createActivityButtons()
      });

      return;
    }

    if (
      interaction.customId ===
      "reset_friendly"
    ) {
      if (
        interaction.user.id !==
        game.hostId
      ) {
        return interaction.reply({
          content:
            "Only the friendly host can reset it.",
          ephemeral: true
        });
      }

      games.delete(
        interaction.guildId
      );

      await interaction.update({
        content:
          "Friendly cancelled.",
        embeds: [],
        components: []
      });

      if (game.lineupMessageId) {
        try {
          const channel =
            await client.channels.fetch(
              game.channelId
            );

          const lineup =
            await channel.messages.fetch(
              game.lineupMessageId
            );

          await lineup.edit({
            content:
              "Friendly cancelled.",
            embeds: [],
            components: []
          });
        } catch {}
      }

      return;
    }

    if (
      interaction.customId ===
      "sub_mode"
    ) {
      if (
        !game.lineupStarted
      ) {
        return interaction.reply({
          content:
            "The lineup hasn't started yet.",
          ephemeral: true
        });
      }

      if (game.locked) {
        return interaction.reply({
          content:
            "The lineup is locked.",
          ephemeral: true
        });
      }

      game.subMode = true;

      await interaction.update({
        embeds: [
          createSubEmbed(game)
        ],
        components:
          createSubButtons(game)
      });

      return;
    }

    if (
      interaction.customId ===
      "cancel_sub"
    ) {
      game.subMode = false;

      await interaction.update({
        embeds: [
          createLineupEmbed(game)
        ],
        components:
          createLineupButtons(game)
      });

      return;
    }

    if (
      interaction.customId.startsWith(
        "position_"
      )
    ) {
      if (
        !game.lineupStarted ||
        game.locked
      ) {
        return interaction.reply({
          content:
            "You can't change the lineup right now.",
          ephemeral: true
        });
      }

      const position =
        interaction.customId.replace(
          "position_",
          ""
        );

      const formation =
        formations[game.needed];

      if (
        !formation.positions.includes(
          position
        )
      ) {
        return interaction.reply({
          content:
            "That position doesn't exist.",
          ephemeral: true
        });
      }

      if (game.subMode) {
        const currentPlayer =
          game.lineup.get(position);

        if (!currentPlayer) {
          return interaction.reply({
            content:
              "That position isn't occupied.",
            ephemeral: true
          });
        }

        if (
          currentPlayer ===
          interaction.user.id
        ) {
          return interaction.reply({
            content:
              "You can't substitute yourself.",
            ephemeral: true
          });
        }

        game.lineup.set(
          position,
          interaction.user.id
        );

        game.players.add(
          interaction.user.id
        );

        game.subMode = false;

        await interaction.update({
          embeds: [
            createLineupEmbed(game)
          ],
          components:
            createLineupButtons(game)
        });

        return;
      }

      if (
        !game.players.has(
          interaction.user.id
        )
      ) {
        return interaction.reply({
          content:
            "You didn't mark yourself as available.",
          ephemeral: true
        });
      }

      const currentPlayer =
        game.lineup.get(position);

      if (
        currentPlayer ===
        interaction.user.id
      ) {
        game.lineup.delete(
          position
        );

        await interaction.update({
          embeds: [
            createLineupEmbed(game)
          ],
          components:
            createLineupButtons(game)
        });

        return;
      }

      if (currentPlayer) {
        return interaction.reply({
          content:
            `${position} is already taken.`,
          ephemeral: true
        });
      }

      const oldPosition =
        getPlayerPosition(
          game,
          interaction.user.id
        );

      if (oldPosition) {
        game.lineup.delete(
          oldPosition
        );
      }

      game.lineup.set(
        position,
        interaction.user.id
      );

      await interaction.update({
        embeds: [
          createLineupEmbed(game)
        ],
        components:
          createLineupButtons(game)
      });

      return;
    }

    if (
      interaction.customId ===
      "lock_lineup"
    ) {
      if (
        interaction.user.id !==
        game.hostId
      ) {
        return interaction.reply({
          content:
            "Only the friendly host can lock the lineup.",
          ephemeral: true
        });
      }

      const formation =
        formations[game.needed];

      if (
        game.lineup.size !==
        formation.positions.length
      ) {
        return interaction.reply({
          content:
            `The lineup isn't complete yet. ${game.lineup.size}/${formation.positions.length} positions filled.`,
          ephemeral: true
        });
      }

      game.locked = true;
      game.subMode = false;

      await interaction.update({
        embeds: [
          createFinalLineupEmbed(game)
        ],
        components: []
      });

      return;
    }
  } catch (error) {
    console.error(
      "Interaction error:",
      error
    );

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content:
          "Something went wrong. Try again.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

/* =========================
   FRIENDLY UI
========================= */

function createActivityButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "can_play"
        )
        .setLabel(
          "CAN PLAY"
        )
        .setEmoji("🟩")
        .setStyle(
          ButtonStyle.Success
        ),

      new ButtonBuilder()
        .setCustomId(
          "cant_play"
        )
        .setLabel(
          "CAN'T PLAY"
        )
        .setEmoji("🟥")
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          "reset_friendly"
        )
        .setLabel(
          "RESET"
        )
        .setStyle(
          ButtonStyle.Secondary
        )
    )
  ];
}

function createActivityEmbed(game) {
  const formation =
    formations[game.needed];

  const playerList =
    game.players.size > 0
      ? [...game.players]
          .map(
            (id, index) =>
              `${index + 1}. <@${id}>`
          )
          .join("\n")
      : "No players yet.";

  const ready =
    game.players.size >=
    game.needed;

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle("Friendly")
    .setDescription(
      `### ${game.players.size}/${game.needed} ${ready ? "READY" : "PLAYERS"}\n` +
      `\`${formation.name}\`\n\n` +
      `**Players**\n` +
      `${playerList}`
    )
    .addFields({
      name: ready
        ? "Status"
        : "Activity check",
      value: ready
        ? "The lineup is ready."
        : "Press **CAN PLAY** if you're available.",
      inline: false
    })
    .setFooter({
      text:
        "Friendly system"
    });
}

async function createLineupMessage(
  interaction,
  game
) {
  if (
    game.lineupMessageId
  ) return;

  const channel =
    interaction.channel;

  if (!channel) return;

  const message =
    await channel.send({
      embeds: [
        createLineupEmbed(game)
      ],
      components:
        createLineupButtons(game)
    });

  game.lineupMessageId =
    message.id;
}

function createLineupEmbed(game) {
  const formation =
    formations[game.needed];

  const get = position => {
    const id =
      game.lineup.get(
        position
      );

    return id
      ? `<@${id}>`
      : "—";
  };

  let description = "";

  if (
    formation.name ===
    "3-1-3"
  ) {
    description =
      `**GK**\n` +
      `${get("GK")}\n\n` +
      `**LB**　　**CB**　　**RB**\n` +
      `${get("LB")}　 ${get("CB")}　 ${get("RB")}\n\n` +
      `**CAM**\n` +
      `${get("CAM")}\n\n` +
      `**LW**　　**ST**　　**RW**\n` +
      `${get("LW")}　 ${get("ST")}　 ${get("RW")}`;
  } else {
    for (
      const position of
      formation.positions
    ) {
      description +=
        `**${position}**\n${get(position)}\n\n`;
    }
  }

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle(
      "Match Lineup"
    )
    .setDescription(
      `**${formation.name}**\n\n` +
      description
    )
    .addFields({
      name: "Players",
      value:
        `${game.lineup.size}/${formation.positions.length} positions selected`,
      inline: false
    })
    .setFooter({
      text:
        "Select a position • click yours again to unchoose • SUB to replace"
    });
}

function createSubEmbed(game) {
  const formation =
    formations[game.needed];

  let description =
    "Choose the player you want to replace.\n\n";

  for (
    const position of
    formation.positions
  ) {
    const id =
      game.lineup.get(
        position
      );

    if (id) {
      description +=
        `**${position}**  <@${id}>\n`;
    }
  }

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle(
      "Substitution"
    )
    .setDescription(
      description
    )
    .setFooter({
      text:
        "Select an occupied position"
    });
}

function createFinalLineupEmbed(game) {
  const formation =
    formations[game.needed];

  let description =
    `**${formation.name}**\n\n`;

  for (
    const position of
    formation.positions
  ) {
    const id =
      game.lineup.get(
        position
      );

    description +=
      `**${position}**  <@${id}>\n`;
  }

  return new EmbedBuilder()
    .setColor(0x18181b)
    .setTitle(
      "Lineup Locked"
    )
    .setDescription(
      description
    )
    .addFields({
      name: "Status",
      value:
        "Ready for the match.",
      inline: false
    })
    .setFooter({
      text:
        "Friendly system"
    });
}

function createLineupButtons(game) {
  const formation =
    formations[game.needed];

  const rows = [];

  let row =
    new ActionRowBuilder();

  for (
    const position of
    formation.positions
  ) {
    const taken =
      game.lineup.has(
        position
      );

    const button =
      new ButtonBuilder()
        .setCustomId(
          `position_${position}`
        )
        .setLabel(
          position
        )
        .setStyle(
          taken
            ? ButtonStyle.Secondary
            : ButtonStyle.Primary
        )
        .setDisabled(false);

    row.addComponents(
      button
    );

    if (
      row.components.length ===
      5
    ) {
      rows.push(row);
      row =
        new ActionRowBuilder();
    }
  }

  if (
    row.components.length > 0
  ) {
    rows.push(row);
  }

  const complete =
    game.lineup.size ===
    formation.positions.length;

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "sub_mode"
        )
        .setLabel(
          "SUB"
        )
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "lock_lineup"
        )
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
        .setDisabled(
          !complete
        )
    )
  );

  return rows;
}

function createSubButtons(game) {
  const formation =
    formations[game.needed];

  const rows = [];

  let row =
    new ActionRowBuilder();

  for (
    const position of
    formation.positions
  ) {
    const taken =
      game.lineup.has(
        position
      );

    const button =
      new ButtonBuilder()
        .setCustomId(
          `position_${position}`
        )
        .setLabel(
          position
        )
        .setStyle(
          taken
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary
        )
        .setDisabled(
          !taken
        );

    row.addComponents(
      button
    );

    if (
      row.components.length ===
      5
    ) {
      rows.push(row);
      row =
        new ActionRowBuilder();
    }
  }

  if (
    row.components.length > 0
  ) {
    rows.push(row);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "cancel_sub"
        )
        .setLabel(
          "CANCEL"
        )
        .setStyle(
          ButtonStyle.Secondary
        )
    )
  );

  return rows;
}

function getPlayerPosition(
  game,
  userId
) {
  for (
    const [
      position,
      playerId
    ] of game.lineup
  ) {
    if (
      playerId === userId
    ) {
      return position;
    }
  }

  return null;
}

client.login(
  process.env.TOKEN
);
