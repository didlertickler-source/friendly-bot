```js
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
  PermissionsBitField,
  ChannelType
} = require("discord.js");

require("dotenv").config();

const PREFIX = "?";

const STAFF_ROLES = [
  "〔✦〕FF Hoster",
  "〔✦〕Trial Hoster",
  "〔✦〕Moderator",
  "〔✦〕Co-Owner",
  "〔✦〕Manager",
  "〔✦〕Founder/Owner"
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const games = new Map();
const warnings = new Map();

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

const friendlyCommand = new SlashCommandBuilder()
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

function isStaff(member) {
  if (!member) return false;

  return member.roles.cache.some(role =>
    STAFF_ROLES.includes(role.name)
  );
}

function staffNames() {
  return STAFF_ROLES.map(role => `• ${role}`).join("\n");
}

function hasPermission(member, permission) {
  if (!member) return false;

  if (isStaff(member)) return true;

  return member.permissions.has(permission);
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(title)
    .setDescription(description);
}

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(title)
    .setDescription(description);
}

function getPlayerPosition(game, userId) {
  for (const [position, playerId] of game.lineup) {
    if (playerId === userId) {
      return position;
    }
  }

  return null;
}

function createActivityEmbed(game) {
  const formation = formations[game.needed];

  const players = [...game.players];

  const playerList = players.length
    ? players
        .map((id, index) => `**${index + 1}.** <@${id}>`)
        .join("\n")
    : "`No players yet`";

  const status =
    players.length >= game.needed
      ? "READY"
      : "ACTIVITY CHECK";

  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle("FRIENDLY MATCH")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━\n` +
      `### ${status}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `**PLAYERS**\n` +
      `\`${players.length}/${game.needed}\`\n\n` +
      `**FORMATION**\n` +
      `\`${formation.name}\`\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `**AVAILABLE PLAYERS**\n\n` +
      `${playerList}\n\n` +
      `━━━━━━━━━━━━━━━━━━`
    )
    .setFooter({
      text: "Select your availability below"
    });
}

function createActivityButtons(game) {
  const disabled =
    game.lineupStarted ||
    game.locked;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("friendly_play")
        .setLabel("CAN PLAY")
        .setEmoji("🟩")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("friendly_no")
        .setLabel("CAN'T PLAY")
        .setEmoji("🟥")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("friendly_cancel")
        .setLabel("CANCEL")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createLineupEmbed(game) {
  const formation = formations[game.needed];

  let text = "";

  for (const position of formation.positions) {
    const playerId = game.lineup.get(position);

    text += `**${position}**\n`;

    if (playerId) {
      text += `<@${playerId}>\n\n`;
    } else {
      text += "`OPEN`\n\n";
    }
  }

  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle("MATCH LINEUP")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━\n` +
      `### FORMATION • ${formation.name}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      text +
      `━━━━━━━━━━━━━━━━━━\n` +
      `**${game.lineup.size}/${formation.positions.length} POSITIONS FILLED**`
    )
    .setFooter({
      text: game.subMode
        ? "SUB MODE • Select an occupied position"
        : "Click your position • click it again to leave"
    });
}

function createFinalLineupEmbed(game) {
  const formation = formations[game.needed];

  let text = "";

  for (const position of formation.positions) {
    const playerId = game.lineup.get(position);

    text += `**${position}**  <@${playerId}>\n`;
  }

  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle("LINEUP LOCKED")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━\n` +
      `### ${formation.name}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      text +
      `\n━━━━━━━━━━━━━━━━━━\n` +
      `**READY FOR THE MATCH**`
    )
    .setFooter({
      text: "Friendly System"
    });
}

function createLineupButtons(game) {
  const formation = formations[game.needed];
  const rows = [];
  let row = new ActionRowBuilder();

  for (const position of formation.positions) {
    const taken = game.lineup.has(position);

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`position_${position}`)
        .setLabel(position)
        .setStyle(
          taken
            ? ButtonStyle.Success
            : ButtonStyle.Primary
        )
        .setDisabled(false)
    );

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
        .setCustomId("friendly_sub")
        .setLabel(
          game.subMode
            ? "CANCEL SUB"
            : "SUB PLAYER"
        )
        .setStyle(
          game.subMode
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId("friendly_lock")
        .setLabel("LOCK LINEUP")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          game.lineup.size !== formation.positions.length
        )
    )
  );

  return rows;
}

async function safeGetMessage(channelId, messageId) {
  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      return null;
    }

    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

async function updateActivity(game) {
  const message = await safeGetMessage(
    game.channelId,
    game.activityMessageId
  );

  if (!message) return false;

  await message.edit({
    embeds: [createActivityEmbed(game)],
    components: createActivityButtons(game)
  });

  return true;
}

async function updateLineup(game) {
  if (!game.lineupMessageId) return false;

  const message = await safeGetMessage(
    game.channelId,
    game.lineupMessageId
  );

  if (!message) return false;

  await message.edit({
    embeds: [createLineupEmbed(game)],
    components: createLineupButtons(game)
  });

  return true;
}

async function createLineup(channel, game) {
  if (game.lineupMessageId) return;

  const message = await channel.send({
    embeds: [createLineupEmbed(game)],
    components: createLineupButtons(game)
  });

  game.lineupMessageId = message.id;
}

client.once("ready", async () => {
  console.log(`${client.user.tag} is online.`);

  try {
    const rest = new REST({ version: "10" })
      .setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: [friendlyCommand.toJSON()]
      }
    );

    console.log("Commands loaded.");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

client.on("messageDelete", async message => {
  if (!message.guild) return;

  const game = games.get(message.guild.id);

  if (!game) return;

  if (
    message.id === game.activityMessageId ||
    message.id === game.lineupMessageId
  ) {
    games.delete(message.guild.id);
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

  const command = args.shift()?.toLowerCase();

  if (!command) return;

  try {
    if (command === "help" || command === "commands") {
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("COMMANDS")
        .setDescription(
          `━━━━━━━━━━━━━━━━━━\n` +
          `### FRIENDLY\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          "`/friendly <4-11>`\n\n" +

          `━━━━━━━━━━━━━━━━━━\n` +
          `### STAFF COMMANDS\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          "`?purge <amount>`\n" +
          "`?clear <amount>`\n" +
          "`?kick @user [reason]`\n" +
          "`?ban @user [reason]`\n" +
          "`?unban <userID>`\n" +
          "`?timeout @user <minutes>`\n" +
          "`?untimeout @user`\n" +
          "`?warn @user [reason]`\n" +
          "`?warnings @user`\n" +
          "`?clearwarnings @user`\n" +
          "`?lock`\n" +
          "`?unlock`\n" +
          "`?slowmode <seconds>`\n" +
          "`?say <message>`\n" +
          "`?announce <message>`\n" +
          "`?poll <question>`\n" +
          "`?nick @user <name>`\n" +
          "`?addrole @user @role`\n" +
          "`?removerole @user @role`\n\n" +

          `━━━━━━━━━━━━━━━━━━\n` +
          `### PUBLIC COMMANDS\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          "`?teamrank XI`\n" +
          "`?ping`\n" +
          "`?userinfo [@user]`\n" +
          "`?serverinfo`\n" +
          "`?avatar [@user]`\n" +
          "`?membercount`\n" +
          "`?roleinfo @role`\n" +
          "`?botinfo`\n" +
          "`?help`"
        )
        .setFooter({
          text: "Friendly Bot"
        });

      return message.reply({
        embeds: [embed]
      });
    }

    if (command === "teamrank") {
      const rank = args.join(" ").toLowerCase();

      if (!rank) {
        return message.reply(
          "Usage: `?teamrank XI`"
        );
      }

      if (rank !== "xi") {
        return message.reply(
          "Available team rank: `XI`"
        );
      }

      const roleName =
        "〔✦〕STARTING XI/MAIN PLAYERS";

      const role = message.guild.roles.cache.find(
        role => role.name === roleName
      );

      if (!role) {
        return message.reply(
          `Role not found: **${roleName}**`
        );
      }

      await message.guild.members.fetch();

      const members = [...role.members.values()]
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        );

      if (!members.length) {
        return message.reply(
          "There are no players in the Starting XI."
        );
      }

      const list = members
        .map(
          (member, index) =>
            `**${index + 1}.** <@${member.id}>`
        )
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("STARTING XI")
        .setDescription(
          `━━━━━━━━━━━━━━━━━━\n` +
          `### MAIN PLAYERS\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          list +
          `\n\n━━━━━━━━━━━━━━━━━━\n` +
          `**TOTAL • ${members.length} PLAYERS**`
        )
        .setFooter({
          text: "Team Rankings"
        });

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (command === "ping") {
      return message.reply(
        `Pong • **${client.ws.ping}ms**`
      );
    }

    if (command === "userinfo") {
      const member =
        message.mentions.members.first() ||
        message.member;

      const roles = member.roles.cache
        .filter(
          role => role.id !== message.guild.id
        )
        .map(role => role.toString())
        .join(", ");

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("USER INFORMATION")
        .setThumbnail(
          member.user.displayAvatarURL({
            size: 1024
          })
        )
        .addFields(
          {
            name: "USER",
            value: member.user.tag,
            inline: true
          },
          {
            name: "ID",
            value: member.id,
            inline: true
          },
          {
            name: "JOINED",
            value: `<t:${Math.floor(
              member.joinedTimestamp / 1000
            )}:R>`,
            inline: true
          },
          {
            name: "ROLES",
            value: roles
              ? roles.slice(0, 1024)
              : "`None`"
          }
        );

      return message.reply({
        embeds: [embed]
      });
    }

    if (command === "avatar") {
      const user =
        message.mentions.users.first() ||
        message.author;

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle(`${user.username}'S AVATAR`)
        .setImage(
          user.displayAvatarURL({
            size: 1024
          })
        );

      return message.reply({
        embeds: [embed]
      });
    }

    if (command === "membercount") {
      return message.reply(
        `**${message.guild.memberCount}** members`
      );
    }

    if (command === "serverinfo") {
      const owner =
        await message.guild.fetchOwner();

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("SERVER INFORMATION")
        .addFields(
          {
            name: "SERVER",
            value: message.guild.name,
            inline: true
          },
          {
            name: "MEMBERS",
            value: `${message.guild.memberCount}`,
            inline: true
          },
          {
            name: "OWNER",
            value: `<@${owner.id}>`,
            inline: true
          },
          {
            name: "CHANNELS",
            value: `${message.guild.channels.cache.size}`,
            inline: true
          },
          {
            name: "ROLES",
            value: `${message.guild.roles.cache.size}`,
            inline: true
          }
        );

      return message.reply({
        embeds: [embed]
      });
    }

    if (command === "roleinfo") {
      const role =
        message.mentions.roles.first();

      if (!role) {
        return message.reply(
          "Usage: `?roleinfo @role`"
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("ROLE INFORMATION")
        .addFields(
          {
            name: "NAME",
            value: role.name,
            inline: true
          },
          {
            name: "MEMBERS",
            value: `${role.members.size}`,
            inline: true
          },
          {
            name: "ID",
            value: role.id,
            inline: true
          }
        );

      return message.reply({
        embeds: [embed]
      });
    }

    if (command === "botinfo") {
      const seconds = Math.floor(
        client.uptime / 1000
      );

      const days = Math.floor(
        seconds / 86400
      );

      const hours = Math.floor(
        (seconds % 86400) / 3600
      );

      const minutes = Math.floor(
        (seconds % 3600) / 60
      );

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("BOT INFORMATION")
        .setDescription(
          `**BOT**\n${client.user.tag}\n\n` +
          `**SERVERS**\n${client.guilds.cache.size}\n\n` +
          `**PING**\n${client.ws.ping}ms\n\n` +
          `**UPTIME**\n${days}d ${hours}h ${minutes}m`
        );

      return message.reply({
        embeds: [embed]
      });
    }

    if (!isStaff(message.member)) {
      return;
    }

    if (command === "purge" || command === "clear") {
      const amount = parseInt(args[0]);

      if (
        !amount ||
        amount < 1 ||
        amount > 100
      ) {
        return message.reply(
          "Usage: `?purge <1-100>`"
        );
      }

      try {
        const deleted =
          await message.channel.bulkDelete(
            amount + 1,
            true
          );

        const confirmation =
          await message.channel.send(
            `Cleared **${Math.max(
              deleted.size - 1,
              0
            )}** messages.`
          );

        setTimeout(() => {
          confirmation.delete().catch(() => {});
        }, 3000);
      } catch {
        return message.reply(
          "I couldn't purge those messages."
        );
      }

      return;
    }

    if (command === "kick") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?kick @user [reason]`"
        );
      }

      if (!member.kickable) {
        return message.reply(
          "I can't kick this member."
        );
      }

      const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

      await member.kick(reason);

      return message.reply(
        `Kicked <@${member.id}>`
      );
    }

    if (command === "ban") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?ban @user [reason]`"
        );
      }

      if (!member.bannable) {
        return message.reply(
          "I can't ban this member."
        );
      }

      const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

      await member.ban({
        reason
      });

      return message.reply(
        `Banned <@${member.id}>`
      );
    }

    if (command === "unban") {
      const userId = args[0];

      if (!userId) {
        return message.reply(
          "Usage: `?unban <userID>`"
        );
      }

      try {
        await message.guild.members.unban(userId);

        return message.reply(
          `Unbanned **${userId}**`
        );
      } catch {
        return message.reply(
          "I couldn't unban that user."
        );
      }
    }

    if (command === "timeout") {
      const member =
        message.mentions.members.first();

      const minutes =
        parseInt(args[1]);

      if (!member || !minutes) {
        return message.reply(
          "Usage: `?timeout @user <minutes>`"
        );
      }

      if (!member.moderatable) {
        return message.reply(
          "I can't timeout this member."
        );
      }

      await member.timeout(
        minutes * 60 * 1000,
        `Timeout by ${message.author.tag}`
      );

      return message.reply(
        `Timed out <@${member.id}> for **${minutes} minutes**.`
      );
    }

    if (command === "untimeout") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?untimeout @user`"
        );
      }

      if (!member.moderatable) {
        return message.reply(
          "I can't modify this member."
        );
      }

      await member.timeout(null);

      return message.reply(
        `Removed timeout from <@${member.id}>`
      );
    }

    if (command === "warn") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?warn @user [reason]`"
        );
      }

      const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

      const key =
        `${message.guild.id}_${member.id}`;

      if (!warnings.has(key)) {
        warnings.set(key, []);
      }

      warnings.get(key).push({
        reason,
        moderator: message.author.id,
        date: Date.now()
      });

      const amount =
        warnings.get(key).length;

      return message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x111111)
            .setTitle("WARNING")
            .setDescription(
              `**USER**\n<@${member.id}>\n\n` +
              `**REASON**\n${reason}\n\n` +
              `**WARNINGS**\n${amount}`
            )
        ]
      });
    }

    if (command === "warnings") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?warnings @user`"
        );
      }

      const key =
        `${message.guild.id}_${member.id}`;

      const userWarnings =
        warnings.get(key) || [];

      if (!userWarnings.length) {
        return message.reply(
          `${member.user.tag} has no warnings.`
        );
      }

      const list = userWarnings
        .map(
          (warning, index) =>
            `**${index + 1}.** ${warning.reason}\nModerator: <@${warning.moderator}>`
        )
        .join("\n\n");

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x111111)
            .setTitle(
              `WARNINGS • ${member.user.username}`
            )
            .setDescription(list)
        ]
      });
    }

    if (command === "clearwarnings") {
      const member =
        message.mentions.members.first();

      if (!member) {
        return message.reply(
          "Usage: `?clearwarnings @user`"
        );
      }

      const key =
        `${message.guild.id}_${member.id}`;

      warnings.delete(key);

      return message.reply(
        `Cleared warnings for <@${member.id}>`
      );
    }

    if (command === "lock") {
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

    if (command === "unlock") {
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

    if (command === "slowmode") {
      const seconds =
        parseInt(args[0]);

      if (
        isNaN(seconds) ||
        seconds < 0 ||
        seconds > 21600
      ) {
        return message.reply(
          "Usage: `?slowmode <0-21600>`"
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

    if (command === "say") {
      const text =
        args.join(" ");

      if (!text) {
        return message.reply(
          "Usage: `?say <message>`"
        );
      }

      await message.delete().catch(() => {});

      return message.channel.send({
        content: text,
        allowedMentions: {
          parse: []
        }
      });
    }

    if (command === "announce") {
      const text =
        args.join(" ");

      if (!text) {
        return message.reply(
          "Usage: `?announce <message>`"
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle("ANNOUNCEMENT")
        .setDescription(text)
        .setFooter({
          text: `Posted by ${message.author.tag}`
        });

      return message.channel.send({
        embeds: [embed]
      });
    }

    if (command === "poll") {
      const question =
        args.join(" ");

      if (!question) {
        return message.reply(
          "Usage: `?poll <question>`"
        );
      }

      const poll =
        await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x111111)
              .setTitle("POLL")
              .setDescription(question)
              .setFooter({
                text: `Created by ${message.author.tag}`
              })
          ]
        });

      await poll.react("👍");
      await poll.react("👎");

      return;
    }

    if (command === "nick") {
      const member =
        message.mentions.members.first();

      const newName =
        args.slice(1).join(" ");

      if (!member || !newName) {
        return message.reply(
          "Usage: `?nick @user <new name>`"
        );
      }

      try {
        await member.setNickname(newName);

        return message.reply(
          `Nickname changed for <@${member.id}>`
        );
      } catch {
        return message.reply(
          "I couldn't change that nickname."
        );
      }
    }

    if (command === "addrole") {
      const member =
        message.mentions.members.first();

      const role =
        message.mentions.roles.first();

      if (!member || !role) {
        return message.reply(
          "Usage: `?addrole @user @role`"
        );
      }

      try {
        await member.roles.add(role);

        return message.reply(
          `Added ${role} to <@${member.id}>`
        );
      } catch {
        return message.reply(
          "I couldn't add that role."
        );
      }
    }

    if (command === "removerole") {
      const member =
        message.mentions.members.first();

      const role =
        message.mentions.roles.first();

      if (!member || !role) {
        return message.reply(
          "Usage: `?removerole @user @role`"
        );
      }

      try {
        await member.roles.remove(role);

        return message.reply(
          `Removed ${role} from <@${member.id}>`
        );
      } catch {
        return message.reply(
          "I couldn't remove that role."
        );
      }
    }

    if (command === "staff") {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x111111)
            .setTitle("BOT STAFF ACCESS")
            .setDescription(
              staffNames()
            )
        ]
      });
    }

    if (command === "cancel") {
      const game =
        games.get(message.guild.id);

      if (!game) {
        return message.reply(
          "There is no active friendly."
        );
      }

      if (!isStaff(message.member)) {
        return;
      }

      const activity =
        await safeGetMessage(
          game.channelId,
          game.activityMessageId
        );

      const lineup =
        await safeGetMessage(
          game.channelId,
          game.lineupMessageId
        );

      if (activity) {
        await activity.edit({
          content:
            "Friendly cancelled by staff.",
          embeds: [],
          components: []
        });
      }

      if (lineup) {
        await lineup.edit({
          content:
            "Friendly cancelled by staff.",
          embeds: [],
          components: []
        });
      }

      games.delete(message.guild.id);

      return message.reply(
        "Friendly cancelled."
      );
    }

  } catch (error) {
    console.error(
      "Command error:",
      error
    );

    return message.reply(
      "Something went wrong while running that command."
    ).catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (
        interaction.commandName !== "friendly"
      ) {
        return;
      }

      const member =
        interaction.member;

      if (!isStaff(member)) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "NO ACCESS",
              "You do not have permission to start a friendly."
            )
          ],
          ephemeral: true
        });
      }

      const guildId =
        interaction.guildId;

      const oldGame =
        games.get(guildId);

      if (oldGame) {
        const activity =
          await safeGetMessage(
            oldGame.channelId,
            oldGame.activityMessageId
          );

        const lineup =
          oldGame.lineupMessageId
            ? await safeGetMessage(
                oldGame.channelId,
                oldGame.lineupMessageId
              )
            : null;

        if (activity || lineup) {
          return interaction.reply({
            content:
              "There is already an active friendly.",
            ephemeral: true
          });
        }

        games.delete(guildId);
      }

      const needed =
        interaction.options.getInteger(
          "players"
        );

      const game = {
        hostId:
          interaction.user.id,
        needed,
        channelId:
          interaction.channelId,
        activityMessageId:
          null,
        lineupMessageId:
          null,
        players:
          new Set(),
        lineup:
          new Map(),
        lineupStarted:
          false,
        locked:
          false,
        subMode:
          false
      };

      games.set(
        guildId,
        game
      );

      const message =
        await interaction.channel.send({
          content: "@everyone",
          embeds: [
            createActivityEmbed(game)
          ],
          components:
            createActivityButtons(game),
          allowedMentions: {
            parse: ["everyone"]
          }
        });

      game.activityMessageId =
        message.id;

      return interaction.reply({
        content:
          "Friendly started.",
        ephemeral: true
      });
    }

    if (!interaction.isButton()) {
      return;
    }

    const game =
      games.get(
        interaction.guildId
      );

    if (!game) {
      return interaction.reply({
        content:
          "This friendly is no longer active.",
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "friendly_play"
    ) {
      if (
        game.lineupStarted
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
            "You are already marked as available.",
          ephemeral: true
        });
      }

      game.players.add(
        interaction.user.id
      );

      const updated =
        await updateActivity(game);

      if (!updated) {
        games.delete(
          interaction.guildId
        );

        return interaction.reply({
          content:
            "The friendly message was deleted. The friendly has been cleared.",
          ephemeral: true
        });
      }

      if (
        game.players.size >=
        game.needed &&
        !game.lineupStarted
      ) {
        game.lineupStarted =
          true;

        await createLineup(
          interaction.channel,
          game
        );

        await updateActivity(game);
      }

      return interaction.reply({
        content:
          "You are marked as available.",
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "friendly_no"
    ) {
      if (
        game.lineupStarted
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

      await updateActivity(game);

      return interaction.reply({
        content:
          "You are marked as unavailable.",
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "friendly_cancel"
    ) {
      const member =
        interaction.member;

      if (
        !isStaff(member)
      ) {
        return interaction.reply({
          content:
            "Only authorized staff can cancel the friendly.",
          ephemeral: true
        });
      }

      const activity =
        await safeGetMessage(
          game.channelId,
          game.activityMessageId
        );

      const lineup =
        await safeGetMessage(
          game.channelId,
          game.lineupMessageId
        );

      if (activity) {
        await activity.edit({
          content:
            "Friendly cancelled.",
          embeds: [],
          components: []
        });
      }

      if (lineup) {
        await lineup.edit({
          content:
            "Friendly cancelled.",
          embeds: [],
          components: []
        });
      }

      games.delete(
        interaction.guildId
      );

      return interaction.reply({
        content:
          "Friendly cancelled.",
        ephemeral: true
      });
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
            "The lineup cannot be changed.",
          ephemeral: true
        });
      }

      const position =
        interaction.customId.replace(
          "position_",
          ""
        );

      const currentPlayer =
        game.lineup.get(
          position
        );

      if (game.subMode) {
        if (!currentPlayer) {
          return interaction.reply({
            content:
              "That position is empty.",
            ephemeral: true
          });
        }

        if (
          currentPlayer ===
          interaction.user.id
        ) {
          return interaction.reply({
            content:
              "You cannot substitute yourself.",
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

        game.subMode =
          false;

        await updateLineup(game);

        return interaction.reply({
          content:
            `You replaced <@${currentPlayer}> at **${position}**.`,
          ephemeral: true
        });
      }

      if (
        !game.players.has(
          interaction.user.id
        )
      ) {
        return interaction.reply({
          content:
            "You must select CAN PLAY first.",
          ephemeral: true
        });
      }

      if (currentPlayer) {
        if (
          currentPlayer ===
          interaction.user.id
        ) {
          game.lineup.delete(
            position
          );

          await updateLineup(game);

          return interaction.reply({
            content:
              `You left **${position}**.`,
            ephemeral: true
          });
        }

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

      await updateLineup(game);

      return interaction.reply({
        content:
          `You selected **${position}**.`,
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "friendly_sub"
    ) {
      if (game.locked) {
        return interaction.reply({
          content:
            "The lineup is locked.",
          ephemeral: true
        });
      }

      game.subMode =
        !game.subMode;

      await updateLineup(game);

      return interaction.reply({
        content:
          game.subMode
            ? "SUB mode enabled. Select an occupied position."
            : "SUB mode disabled.",
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "friendly_lock"
    ) {
      if (
        !isStaff(
          interaction.member
        )
      ) {
        return interaction.reply({
          content:
            "Only authorized staff can lock the lineup.",
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
            `The lineup is not complete. ${game.lineup.size}/${formation.positions.length}`,
          ephemeral: true
        });
      }

      game.locked =
        true;

      const message =
        await safeGetMessage(
          game.channelId,
          game.lineupMessageId
        );

      if (message) {
        await message.edit({
          embeds: [
            createFinalLineupEmbed(game)
          ],
          components: []
        });
      }

      return interaction.reply({
        content:
          "Lineup locked.",
        ephemeral: true
      });
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
          "Something went wrong.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
```
