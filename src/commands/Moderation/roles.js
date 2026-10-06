import {
    SlashCommandBuilder,
    PermissionFlagsBits,
} from 'discord.js';

import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/validation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName("roles")
        .setDescription("Send a direct message to all members of a role (Staff only)")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The role whose members will receive the DM")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The message to send")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),

    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);

        if (!deferSuccess) {
            logger.warn(`Roles DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'roles'
            });
            return;
        }

        const role = interaction.options.getRole("role");
        const message = interaction.options.getString("message");
        const anonymous =
            interaction.options.getBoolean("anonymous") || false;

        try {
            if (message.length > 2000) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.UNKNOWN,
                    message: 'Messages must be under 2000 characters.'
                });
            }

            if (!role) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.UNKNOWN,
                    message: 'The selected role could not be found.'
                });
            }

            // Fetch all members so offline members are included.
            await interaction.guild.members.fetch();

            const members = role.members.filter(member => !member.user.bot);
            const total = members.size;

            if (total === 0) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.UNKNOWN,
                    message: `There are no non-bot members in ${role}.`
                });
            }

            const sanitized = sanitizeMarkdown(message);

            let sent = 0;
            let failed = 0;
            let processed = 0;

            // Show progress immediately instead of leaving "Thinking..."
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "📨 Role DM Progress",
                        [
                            `**Role:** ${role}`,
                            `**Total Members:** ${total}`,
                            `**Sent:** 0`,
                            `**Failed:** 0`,
                            `**Remaining:** ${total}`,
                            `**Progress:** 0%`,
                            ``,
                            `⏳ Sending messages...`
                        ].join("\n")
                    )
                ]
            });

            for (const [, member] of members) {
                try {
                    const dmChannel = await member.user.createDM();

                    await dmChannel.send({
                        embeds: [
                            successEmbed(
                                anonymous
                                    ? "Message from the Staff Team"
                                    : `Message from ${interaction.user.tag}`,
                                sanitized
                            ).setFooter({
                                text: `You cannot reply to this message. | Logger ID: ${interaction.id}`
                            })
                        ]
                    });

                    sent++;

                } catch (error) {
                    failed++;

                    logger.warn(`Could not DM ${member.user.tag}`, {
                        userId: member.user.id,
                        error: error.message
                    });
                }

                processed++;

                // Update the progress every 10 members.
                if (processed % 10 === 0 || processed === total) {
                    const percentage = Math.floor(
                        (processed / total) * 100
                    );

                    try {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                successEmbed(
                                    "📨 Role DM Progress",
                                    [
                                        `**Role:** ${role}`,
                                        `**Total Members:** ${total}`,
                                        `**Sent:** ${sent}`,
                                        `**Failed:** ${failed}`,
                                        `**Remaining:** ${total - processed}`,
                                        `**Progress:** ${percentage}%`,
                                        ``,
                                        processed === total
                                            ? `🏁 **Finished sending messages.**`
                                            : `⏳ **Sending messages...**`
                                    ].join("\n")
                                )
                            ]
                        });
                    } catch (progressError) {
                        logger.warn("Could not update role DM progress", {
                            error: progressError.message
                        });
                    }
                }

                // Small delay to avoid hammering Discord's API.
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            // Final result
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "✅ Role DM Complete",
                        [
                            `**Role:** ${role}`,
                            `**Members:** ${total}`,
                            `**Sent:** ${sent}`,
                            `**Failed:** ${failed}`,
                            `**Progress:** 100%`,
                            ``,
                            `🏁 **All messages have been processed.**`
                        ].join("\n")
                    )
                ]
            });

        } catch (error) {
            logger.error('Roles DM command error:', error);

            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: `Failed to send role DMs: ${error.message}`
            });
        }
    }
};

