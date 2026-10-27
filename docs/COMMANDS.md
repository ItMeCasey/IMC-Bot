# Slash commands

Generated from the code by `node tools/gen-commands-doc.js`; do not edit by hand.
Discord decides who sees each command from its default permission. A server owner can change that in **Server Settings, Integrations, IMC-Bot**.

## Moderation

### `/warn`

Warn someone (it goes on their record)  
Who: People with **ModerateMembers**.

- `user` (person, required): The person
- `reason` (text, required): Why

### `/timeout`

Time someone out (they cannot talk or join voice)  
Who: People with **ModerateMembers**.

- `user` (person, required): The person
- `duration` (text, required): Like 10m, 2h, 7d (max 28d)
- `reason` (text, optional): Why

### `/untimeout`

Lift a timeout  
Who: People with **ModerateMembers**.

- `user` (person, required): The person
- `reason` (text, optional): Why

### `/kick`

Remove someone from the server (they can come back)  
Who: People with **KickMembers**.

- `user` (person, required): The person
- `reason` (text, optional): Why

### `/ban`

Ban someone (also works for people who already left)  
Who: People with **BanMembers**.

- `user` (person, required): The person
- `reason` (text, optional): Why
- `delete_days` (whole number, optional): Also delete their messages from the last N days (0 to 7)

### `/unban`

Unban someone by their user ID  
Who: People with **BanMembers**.

- `user_id` (text, required): Their Discord user ID
- `reason` (text, optional): Why

### `/unwarn`

Remove a warning (so it stops counting)  
Who: People with **ModerateMembers**.

- `case` (whole number, required): The case number

### `/note`

Write a private note about someone (only mods see it)  
Who: People with **ModerateMembers**.

- `user` (person, required): The person
- `text` (text, required): The note

### `/case`

Look up a case  
Who: People with **ModerateMembers**.

- `number` (whole number, required): The case number

### `/history`

A person's record: warnings, timeouts, bans, notes  
Who: People with **ModerateMembers**.

- `user` (person, required): The person

### `/purge`

Delete recent messages in this channel  
Who: People with **ManageMessages**.

- `count` (whole number, required): How many (1 to 100)
- `user` (person, optional): Only this person's messages

### `/slowmode`

Set slowmode for this channel  
Who: People with **ManageChannels**.

- `seconds` (whole number, required): 0 turns it off (max 21600)

### `/lock`

Stop everyone from talking in this channel  
Who: People with **ManageChannels**.

### `/unlock`

Let everyone talk in this channel again (only for a channel locked with /lock)  
Who: People with **ManageChannels**.

## Regulars

### `/progress`

How close you are to becoming a Regular  
Who: Everyone.

### `/regular`

Mods: look at, grant or remove the Regular role  
Who: People with **ModerateMembers**.

- `/regular status`: Someone's progress
  - `user` (person, required): The person
- `/regular grant`: Make someone a Regular now
  - `user` (person, required): The person
- `/regular revoke`: Remove the role and hold them back
  - `user` (person, required): The person

## Community

### `/giveaway`

Run giveaways  
Who: People with **ManageMessages**.

- `/giveaway start`: Start a giveaway in this channel
  - `prize` (text, required): What is given away
  - `duration` (text, required): Like 30m, 2h, 7d (10 seconds up to 30 days)
  - `winners` (whole number, optional): How many winners (default 1)
  - `role` (role, optional): Only people with this role can enter
- `/giveaway end`: End a giveaway now and draw
  - `id` (whole number, required): The giveaway number
- `/giveaway cancel`: Cancel a giveaway without drawing
  - `id` (whole number, required): The giveaway number
- `/giveaway reroll`: Draw new winners for an ended giveaway
  - `id` (whole number, required): The giveaway number
  - `count` (whole number, optional): How many new winners (default 1)
- `/giveaway list`: The giveaways that are running

### `/poll`

Ask a question with buttons as answers  
Who: People with **ManageMessages**.

- `/poll start`: Start a poll in this channel
  - `question` (text, required): The question
  - `answers` (text, required): 2 to 5 answers, separated by | (for example: Yes | No | Maybe)
  - `duration` (text, optional): Like 10m, 2h, 1d (30 seconds up to 7 days). Default 1h
- `/poll end`: End a poll now
  - `id` (whole number, required): The poll number

### `/suggest`

Suggest something for the stream or the server  
Who: Everyone.

- `idea` (text, required): Your suggestion

### `/suggestion`

Mods: answer a suggestion  
Who: People with **ManageMessages**.

- `/suggestion approve`: Mark it approved
  - `id` (whole number, required): The suggestion number
  - `reason` (text, optional): A short answer for everyone
- `/suggestion deny`: Mark it denied
  - `id` (whole number, required): The suggestion number
  - `reason` (text, optional): A short answer for everyone
- `/suggestion done`: Mark it as done
  - `id` (whole number, required): The suggestion number
  - `reason` (text, optional): A short answer for everyone

### `/rank`

Your level and XP (or someone else's)  
Who: Everyone.

- `user` (person, optional): Another person

### `/leaderboard`

The most active people (XP)  
Who: Everyone.

### `/xp`

Mods: manage XP  
Who: People with **ManageGuild**.

- `/xp reset`: Reset someone to zero XP
  - `user` (person, required): The person

## Panels with buttons

### `/rolepanel`

Post a message with buttons that give or remove roles  
Who: People with **ManageRoles**.

- `title` (text, required): Heading of the message
- `role1` (role, required): Role 1
- `text` (text, optional): What the buttons are for
- `role2` (role, optional): Role 2
- `role3` (role, optional): Role 3
- `role4` (role, optional): Role 4
- `role5` (role, optional): Role 5
- `role6` (role, optional): Role 6
- `role7` (role, optional): Role 7
- `role8` (role, optional): Role 8
- `role9` (role, optional): Role 9
- `role10` (role, optional): Role 10

### `/ticketpanel`

Post a message with a button that opens a private ticket channel  
Who: People with **ManageChannels**.

- `title` (text, required): Heading of the message
- `text` (text, optional): What tickets are for (questions, ban appeals...)
- `button` (text, optional): Button text (default: Open a ticket)

### `/verifypanel`

Post a message with a Verify button  
Who: People with **ManageRoles**.

- `title` (text, optional): Heading (default: Verify)
- `text` (text, optional): What to tell newcomers

## Stream information

### `/commands`

The chat commands of the stream  
Who: Everyone.

### `/games`

The games you can play in chat  
Who: Everyone.

### `/tts`

How to get your message read out loud on stream  
Who: Everyone.

### `/top`

The points leaderboard  
Who: Everyone.

### `/live`

Is the stream live right now?  
Who: Everyone.

### `/website`

The stream website  
Who: Everyone.

### `/schedule`

When the next streams are  
Who: Everyone.

## Other

### `/ping`

Is the bot alive?  
Who: Everyone.
