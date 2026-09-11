require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const PREFIX = "?";

const STAFF_ROLES = [
  "〔✦〕FF Hoster",
  "〔✦〕Trial Hoster",
  "〔✦〕Moderator",
  "〔✦〕Co-Owner",
  "〔✦〕Manager",
  "〔✦〕Founder/Owner"
];

const TEAM_ROLES = {
  "XI": "〔✦〕STARTING XI/MAIN PLAYERS",
  "MAIN": "〔✦〕STARTING XI/MAIN PLAYERS",
  "BENCH": "〔✦〕MAIN TEAM BENCH",
  "A+": "〔✦〕A+ RESERVE",
  "A": "〔✦〕A RESERVE",
  "B+": "〔✦〕B+ RESERVE",
  "B": "〔✦〕B RESERVE",
  "C+": "〔✦〕C+ RESERVE",
  "C": "〔✦〕C RESERVE",
  "D": "〔✦〕D RESERVE"
};

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
    name: "3-1-3",
    positions: ["GK", "LB", "CB", "RB", "CAM", "LW", "ST"]
  },

  8: {
    name: "3-1-3-1",
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

const games = new Map();

function isStaff(member) {
  if (!member) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  return member.roles.cache.some(function(role) {
    return STAFF_ROLES.includes(role.name);
  });
}

function getStaffRoles() {
  return STAFF_ROLES.map(function(role) {
    return "- " + role;
  }).join("\n");
}

function getGame(guildId) {
  return games.get(guildId);
}

function deleteGame(guildId) {
  games.delete(guildId);
}

function getFormation(players) {
  return formations[players];
}

function makeActivityEmbed(game) {
  const formation = getFormation(game.needed);

  const players = Array.from(game.players);

  let playerList = "Nobody yet";

  if (players.length > 0) {
    playerList = players
      .map(function(id, index) {
        return String(index + 1) + ". <@" + id + ">";
      })
      .join("\n");
  }

  const remaining = Math.max(0, game.needed - players.length);

  let status = "";

  if (players.length >= game.needed) {
    status = "READY";
  } else {
    status = String(players.length) +
      "/" +
      String(game.needed) +
      " PLAYERS";
  }

  return new EmbedBuilder()
    .setColor(0x202020)
    .setTitle("FRIENDLY MATCH")
    .setDescription(
      "--------------------------------\n" +
      "ACTIVITY CHECK\n" +
      "--------------------------------\n\n" +
      "**STATUS:** " + status + "\n\n" +
      "**PLAYERS NEEDED:** " + game.needed + "\n" +
      "**PLAYERS JOINED:** " + players.length + "\n" +
      "**PLAYERS LEFT:** " + remaining + "\n" +
      "**FORMATION:** " + formation.name + "\n\n" +
      "--------------------------------\n" +
      "PLAYERS\n" +
      "--------------------------------\n\n" +
      playerList + "\n\n" +
      "--------------------------------\n" +
      "Click CAN PLAY if you are available.\n" +
      "Click CANT PLAY to remove yourself."
    )
    .setFooter({
      text: "Friendly System"
    })
    .setTimestamp();
}

function activityButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("friendly_can_play")
        .setLabel("CAN PLAY")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("friendly_cant_play")
        .setLabel("CANT PLAY")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("friendly_cancel")
        .setLabel("CANCEL")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function makeLineupEmbed(game) {
  const formation = getFormation(game.needed);

  let text = "";

  formation.positions.forEach(function(position) {
    const player = game.lineup.get(position);

    if (player) {
      text += "**" + position + "** - <@" + player + ">\n";
    } else {
      text += "**" + position + "** - AVAILABLE\n";
    }
  });

  let subs = "No substitutes";

  if (game.subs.length > 0) {
    subs = game.subs
      .map(function(id, index) {
        return String(index + 1) + ". <@" + id + ">";
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0x202020)
    .setTitle("MATCH LINEUP")
    .setDescription(
      "--------------------------------\n" +
      "FORMATION: " + formation.name + "\n" +
      "--------------------------------\n\n" +
      text +
      "\n--------------------------------\n" +
      "SUBSTITUTES\n" +
      "--------------------------------\n\n" +
      subs +
      "\n\n--------------------------------\n" +
      "Click a position to claim it.\n" +
      "Click your position again to leave it."
    )
    .setFooter({
      text: "One player can only have one position"
    })
    .setTimestamp();
}

function lineupButtons(game) {
  const formation = getFormation(game.needed);
  const rows = [];

  let row = new ActionRowBuilder();

  formation.positions.forEach(function(position) {
    const taken = game.lineup.has(position);

    const button = new ButtonBuilder()
      .setCustomId("position_" + position)
      .setLabel(position)
      .setStyle(taken ? ButtonStyle.Secondary : ButtonStyle.Primary);

    row.addComponents(button);

    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
  });

  if (row.components.length > 0) {
    rows.push(row);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("join_sub")
        .setLabel("JOIN AS SUB")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("leave_sub")
        .setLabel("LEAVE SUBS")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("finish_friendly")
        .setLabel("FINISH")
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows;
}

async function updateActivityMessage(game) {
  try {
    const channel = await client.channels.fetch(game.channelId);

    if (!channel) return;

    const message = await channel.messages.fetch(game.activityMessageId);

    if (!message) return;

    await message.edit({
      embeds: [makeActivityEmbed(game)],
      components: activityButtons()
    });
  } catch (error) {
    game.activityMessageId = null;
  }
}

async function updateLineupMessage(game) {
  try {
    if (!game.lineupMessageId) return;

    const channel = await client.channels.fetch(game.channelId);

    if (!channel) return;

    const message = await channel.messages.fetch(game.lineupMessageId);

    if (!message) return;

    await message.edit({
      embeds: [makeLineupEmbed(game)],
      components: lineupButtons(game)
    });
  } catch (error) {
    game.lineupMessageId = null;
  }
}

async function createLineup(channel, game) {
  if (game.lineupMessageId) return;

  const message = await channel.send({
    content: "LINEUP IS NOW OPEN",
    embeds: [makeLineupEmbed(game)],
    components: lineupButtons(game)
  });

  game.lineupMessageId = message.id;
}

function userPosition(game, userId) {
  for (const entry of game.lineup.entries()) {
    const position = entry[0];
    const player = entry[1];

    if (player === userId) {
      return position;
    }
  }

  return null;
}

function removePlayerFromLineup(game, userId) {
  const position = userPosition(game, userId);

  if (position) {
    game.lineup.delete(position);
  }

  const subIndex = game.subs.indexOf(userId);

  if (subIndex !== -1) {
    game.subs.splice(subIndex, 1);
  }
}

function cleanDeletedGame(game) {
  if (!game) return;

  if (!game.channelId) return;

  if (!game.activityMessageId) {
    deleteGame(game.guildId);
  }
}

client.once("ready", function() {
  console.log("Logged in as " + client.user.tag);
  console.log("Friendly bot is online.");
});

client.on("messageCreate", async function(message) {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content
      .slice(PREFIX.length)
      .trim()
      .split(/\s+/);

    const command = args.shift().toLowerCase();

    if (command === "help") {
      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("BOT COMMANDS")
        .setDescription(
          "--------------------------------\n" +
          "FRIENDLY COMMANDS\n" +
          "--------------------------------\n\n" +
          "`?friendly <4-11>` - Start a friendly\n" +
          "`?cancel` - Cancel active friendly\n" +
          "`?status` - Show friendly status\n" +
          "`?lineup` - Show current lineup\n\n" +
          "--------------------------------\n" +
          "MODERATION\n" +
          "--------------------------------\n\n" +
          "`?purge <amount>` - Delete messages\n" +
          "`?kick @user [reason]`\n" +
          "`?ban @user [reason]`\n" +
          "`?unban <userId>`\n" +
          "`?timeout @user <minutes>`\n" +
          "`?untimeout @user`\n\n" +
          "--------------------------------\n" +
          "SERVER\n" +
          "--------------------------------\n\n" +
          "`?teamrank <rank>`\n" +
          "`?userinfo [@user]`\n" +
          "`?serverinfo`\n" +
          "`?avatar [@user]`\n" +
          "`?roleinfo <role>`\n" +
          "`?members`\n" +
          "`?roles`\n\n" +
          "--------------------------------\n" +
          "UTILITY\n" +
          "--------------------------------\n\n" +
          "`?ping`\n" +
          "`?botinfo`\n" +
          "`?say <text>`\n" +
          "`?embed <text>`\n" +
          "`?coinflip`\n" +
          "`?8ball <question>`\n" +
          "`?staff`\n\n" +
          "Staff-only commands require an allowed staff role."
        )
        .setTimestamp();

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "ping") {
      await message.reply("Pong: " + client.ws.ping + "ms");
      return;
    }

    if (command === "botinfo") {
      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("BOT INFORMATION")
        .setDescription(
          "**NAME:** " + client.user.username + "\n" +
          "**SERVERS:** " + client.guilds.cache.size + "\n" +
          "**PING:** " + client.ws.ping + "ms\n" +
          "**PREFIX:** " + PREFIX
        );

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "avatar") {
      const user = message.mentions.users.first() || message.author;

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle(user.username + " AVATAR")
        .setImage(user.displayAvatarURL({
          size: 1024
        }));

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "userinfo") {
      const member =
        message.mentions.members.first() ||
        message.member;

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("USER INFORMATION")
        .setDescription(
          "**USER:** " + member.user.tag + "\n" +
          "**ID:** " + member.id + "\n" +
          "**JOINED:** <t:" +
          Math.floor(member.joinedTimestamp / 1000) +
          ":R>\n" +
          "**ACCOUNT CREATED:** <t:" +
          Math.floor(member.user.createdTimestamp / 1000) +
          ":R>"
        )
        .setThumbnail(member.user.displayAvatarURL());

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "serverinfo") {
      const guild = message.guild;

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("SERVER INFORMATION")
        .setDescription(
          "**NAME:** " + guild.name + "\n" +
          "**ID:** " + guild.id + "\n" +
          "**MEMBERS:** " + guild.memberCount + "\n" +
          "**CHANNELS:** " + guild.channels.cache.size + "\n" +
          "**ROLES:** " + guild.roles.cache.size + "\n" +
          "**OWNER:** <@" + guild.ownerId + ">"
        );

      if (guild.iconURL()) {
        embed.setThumbnail(guild.iconURL());
      }

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "members") {
      await message.reply(
        "This server has " +
        message.guild.memberCount +
        " members."
      );

      return;
    }

    if (command === "roles") {
      const roles = message.guild.roles.cache
        .filter(function(role) {
          return role.name !== "@everyone";
        })
        .map(function(role) {
          return role.name;
        })
        .slice(0, 50);

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("SERVER ROLES")
        .setDescription(
          roles.length > 0
            ? roles.join("\n")
            : "No roles found."
        );

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "coinflip") {
      const result = Math.random() < 0.5
        ? "HEADS"
        : "TAILS";

      await message.reply("Coinflip: " + result);
      return;
    }

    if (command === "8ball") {
      if (!args.length) {
        await message.reply("Ask a question.");
        return;
      }

      const answers = [
        "Yes.",
        "No.",
        "Probably.",
        "Probably not.",
        "Definitely.",
        "I would not count on it.",
        "Maybe."
      ];

      const answer =
        answers[Math.floor(Math.random() * answers.length)];

      await message.reply(answer);
      return;
    }

    if (command === "teamrank") {
      const rank = args.join(" ").toUpperCase();

      if (!rank) {
        await message.reply(
          "Usage: ?teamrank XI\n" +
          "Available: XI, MAIN, BENCH, A+, A, B+, B, C+, C, D"
        );

        return;
      }

      const roleName = TEAM_ROLES[rank];

      if (!roleName) {
        await message.reply(
          "Unknown rank. Try: XI, MAIN, BENCH, A+, A, B+, B, C+, C or D."
        );

        return;
      }

      const role = message.guild.roles.cache.find(function(r) {
        return r.name === roleName;
      });

      if (!role) {
        await message.reply(
          "The role `" + roleName + "` was not found."
        );

        return;
      }

      const members = role.members.map(function(member) {
        return "<@" + member.id + ">";
      });

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle(roleName)
        .setDescription(
          "**PLAYERS:** " + members.length + "\n\n" +
          (members.length > 0
            ? members.join("\n")
            : "No players have this role.")
        );

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (!isStaff(message.member)) {
      return;
    }

    if (command === "staff") {
      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("ALLOWED STAFF ROLES")
        .setDescription(getStaffRoles());

      await message.reply({
        embeds: [embed]
      });

      return;
    }

    if (command === "friendly") {
      const amount = Number(args[0]);

      if (
        !Number.isInteger(amount) ||
        amount < 4 ||
        amount > 11
      ) {
        await message.reply(
          "Usage: ?friendly <4-11>"
        );

        return;
      }

      const oldGame = getGame(message.guild.id);

      if (oldGame) {
        if (oldGame.activityMessageId) {
          try {
            const oldChannel =
              await client.channels.fetch(oldGame.channelId);

            if (oldChannel) {
              await oldChannel.messages.fetch(
                oldGame.activityMessageId
              );
            }

            await message.reply(
              "There is already an active friendly."
            );

            return;
          } catch (error) {
            deleteGame(message.guild.id);
          }
        } else {
          deleteGame(message.guild.id);
        }
      }

      const game = {
        guildId: message.guild.id,
        channelId: message.channel.id,
        needed: amount,
        players: new Set(),
        lineup: new Map(),
        subs: [],
        activityMessageId: null,
        lineupMessageId: null,
        hostId: message.author.id
      };

      games.set(message.guild.id, game);

      const sent = await message.channel.send({
        content: "@everyone",
        embeds: [makeActivityEmbed(game)],
        components: activityButtons(),
        allowedMentions: {
          parse: ["everyone"]
        }
      });

      game.activityMessageId = sent.id;

      await message.delete().catch(function() {});

      return;
    }

    if (command === "cancel") {
      const game = getGame(message.guild.id);

      if (!game) {
        await message.reply(
          "There is no active friendly."
        );

        return;
      }

      deleteGame(message.guild.id);

      await message.reply(
        "The friendly has been cancelled."
      );

      return;
    }

    if (command === "status") {
      const game = getGame(message.guild.id);

      if (!game) {
        await message.reply(
          "There is no active friendly."
        );

        return;
      }

      await message.reply({
        embeds: [makeActivityEmbed(game)]
      });

      return;
    }

    if (command === "lineup") {
      const game = getGame(message.guild.id);

      if (!game) {
        await message.reply(
          "There is no active friendly."
        );

        return;
      }

      await message.reply({
        embeds: [makeLineupEmbed(game)]
      });

      return;
    }

    if (command === "purge") {
      const amount = Number(args[0]);

      if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100
      ) {
        await message.reply(
          "Usage: ?purge <1-100>"
        );

        return;
      }

      await message.channel.bulkDelete(
        amount + 1,
        true
      );

      const confirmation =
        await message.channel.send(
          "Deleted " + amount + " messages."
        );

      setTimeout(function() {
        confirmation.delete().catch(function() {});
      }, 3000);

      return;
    }

    if (command === "say") {
      const text = args.join(" ");

      if (!text) {
        await message.reply(
          "Usage: ?say <text>"
        );

        return;
      }

      await message.delete().catch(function() {});
      await message.channel.send(text);

      return;
    }

    if (command === "embed") {
      const text = args.join(" ");

      if (!text) {
        await message.reply(
          "Usage: ?embed <text>"
        );

        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setDescription(text);

      await message.channel.send({
        embeds: [embed]
      });

      return;
    }

    if (command === "kick") {
      const member = message.mentions.members.first();

      if (!member) {
        await message.reply(
          "Mention a user to kick."
        );

        return;
      }

      if (!member.kickable) {
        await message.reply(
          "I cannot kick that member."
        );

        return;
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.kick(reason);

      await message.reply(
        member.user.tag + " was kicked."
      );

      return;
    }

    if (command === "ban") {
      const member = message.mentions.members.first();

      if (!member) {
        await message.reply(
          "Mention a user to ban."
        );

        return;
      }

      if (!member.bannable) {
        await message.reply(
          "I cannot ban that member."
        );

        return;
      }

      const reason =
        args.slice(1).join(" ") || "No reason provided";

      await member.ban({
        reason: reason
      });

      await message.reply(
        member.user.tag + " was banned."
      );

      return;
    }

    if (command === "unban") {
      const id = args[0];

      if (!id) {
        await message.reply(
          "Usage: ?unban <userId>"
        );

        return;
      }

      try {
        await message.guild.members.unban(id);

        await message.reply(
          "User was unbanned."
        );
      } catch (error) {
        await message.reply(
          "I could not unban that user."
        );
      }

      return;
    }

    if (command === "timeout") {
      const member = message.mentions.members.first();
      const minutes = Number(args[1]);

      if (!member || !Number.isInteger(minutes)) {
        await message.reply(
          "Usage: ?timeout @user <minutes>"
        );

        return;
      }

      if (!member.moderatable) {
        await message.reply(
          "I cannot timeout that member."
        );

        return;
      }

      await member.timeout(
        minutes * 60 * 1000,
        "Timeout command"
      );

      await message.reply(
        member.user.tag +
        " was timed out for " +
        minutes +
        " minutes."
      );

      return;
    }

    if (command === "untimeout") {
      const member = message.mentions.members.first();

      if (!member) {
        await message.reply(
          "Mention a user."
        );

        return;
      }

      await member.timeout(null);

      await message.reply(
        member.user.tag +
        " timeout was removed."
      );

      return;
    }

    if (command === "roleinfo") {
      const name = args.join(" ");

      if (!name) {
        await message.reply(
          "Usage: ?roleinfo <role name>"
        );

        return;
      }

      const role = message.guild.roles.cache.find(function(r) {
        return r.name.toLowerCase() === name.toLowerCase();
      });

      if (!role) {
        await message.reply(
          "Role not found."
        );

        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x202020)
        .setTitle("ROLE INFORMATION")
        .setDescription(
          "**NAME:** " + role.name + "\n" +
          "**ID:** " + role.id + "\n" +
          "**MEMBERS:** " + role.members.size
        );

      await message.reply({
        embeds: [embed]
      });

      return;
    }
  } catch (error) {
    console.error("COMMAND ERROR:", error);

    message.reply(
      "An error occurred while running that command."
    ).catch(function() {});
  }
});

client.on("interactionCreate", async function(interaction) {
  if (!interaction.isButton()) return;

  try {
    const game = getGame(interaction.guild.id);

    if (!game) {
      await interaction.reply({
        content: "There is no active friendly.",
        ephemeral: true
      });

      return;
    }

    if (interaction.customId === "friendly_can_play") {
      if (game.players.has(interaction.user.id)) {
        await interaction.reply({
          content: "You are already marked as available.",
          ephemeral: true
        });

        return;
      }

      game.players.add(interaction.user.id);

      await interaction.deferUpdate();

      await updateActivityMessage(game);

      if (game.players.size >= game.needed) {
        await createLineup(interaction.channel, game);
      }

      return;
    }

    if (interaction.customId === "friendly_cant_play") {
      game.players.delete(interaction.user.id);

      removePlayerFromLineup(
        game,
        interaction.user.id
      );

      await interaction.deferUpdate();

      await updateActivityMessage(game);
      await updateLineupMessage(game);

      return;
    }

    if (interaction.customId === "friendly_cancel") {
      if (!isStaff(interaction.member)) {
        await interaction.reply({
          content: "Only staff can cancel the friendly.",
          ephemeral: true
        });

        return;
      }

      deleteGame(interaction.guild.id);

      await interaction.update({
        content: "FRIENDLY CANCELLED",
        embeds: [],
        components: []
      });

      return;
    }

    if (interaction.customId === "finish_friendly") {
      if (!isStaff(interaction.member)) {
        await interaction.reply({
          content: "Only staff can finish the friendly.",
          ephemeral: true
        });

        return;
      }

      deleteGame(interaction.guild.id);

      await interaction.update({
        content: "FRIENDLY FINISHED",
        embeds: [],
        components: []
      });

      return;
    }

    if (interaction.customId === "join_sub") {
      if (!game.players.has(interaction.user.id)) {
        await interaction.reply({
          content: "You must join the activity check first.",
          ephemeral: true
        });

        return;
      }

      const position = userPosition(
        game,
        interaction.user.id
      );

      if (position) {
        await interaction.reply({
          content:
            "Leave your current position before joining substitutes.",
          ephemeral: true
        });

        return;
      }

      if (game.subs.includes(interaction.user.id)) {
        await interaction.reply({
          content: "You are already a substitute.",
          ephemeral: true
        });

        return;
      }

      game.subs.push(interaction.user.id);

      await interaction.deferUpdate();
      await updateLineupMessage(game);

      return;
    }

    if (interaction.customId === "leave_sub") {
      const index = game.subs.indexOf(
        interaction.user.id
      );

      if (index === -1) {
        await interaction.reply({
          content: "You are not a substitute.",
          ephemeral: true
        });

        return;
      }

      game.subs.splice(index, 1);

      await interaction.deferUpdate();
      await updateLineupMessage(game);

      return;
    }

    if (
      interaction.customId.startsWith("position_")
    ) {
      const position =
        interaction.customId.replace("position_", "");

      if (!game.players.has(interaction.user.id)) {
        await interaction.reply({
          content:
            "You must click CAN PLAY before choosing a position.",
          ephemeral: true
        });

        return;
      }

      const currentPosition = userPosition(
        game,
        interaction.user.id
      );

      if (currentPosition === position) {
        game.lineup.delete(position);

        await interaction.deferUpdate();
        await updateLineupMessage(game);

        return;
      }

      if (currentPosition) {
        await interaction.reply({
          content:
            "You already have " +
            currentPosition +
            ". Click it again to leave it first.",
          ephemeral: true
        });

        return;
      }

      if (game.lineup.has(position)) {
        await interaction.reply({
          content:
            position + " is already taken.",
          ephemeral: true
        });

        return;
      }

      const subIndex = game.subs.indexOf(
        interaction.user.id
      );

      if (subIndex !== -1) {
        game.subs.splice(subIndex, 1);
      }

      game.lineup.set(
        position,
        interaction.user.id
      );

      await interaction.deferUpdate();
      await updateLineupMessage(game);

      return;
    }
  } catch (error) {
    console.error("BUTTON ERROR:", error);

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction.reply({
        content: "Something went wrong.",
        ephemeral: true
      }).catch(function() {});
    }
  }
});

client.on("messageDelete", function(message) {
  if (!message.guild) return;

  const game = getGame(message.guild.id);

  if (!game) return;

  if (message.id === game.activityMessageId) {
    game.activityMessageId = null;
    deleteGame(message.guild.id);
  }

  if (message.id === game.lineupMessageId) {
    game.lineupMessageId = null;
  }
});

process.on("unhandledRejection", function(error) {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", function(error) {
  console.error("UNCAUGHT EXCEPTION:", error);
});

if (!process.env.TOKEN) {
  console.error("TOKEN is missing.");
  process.exit(1);
}

client.login(process.env.TOKEN);
