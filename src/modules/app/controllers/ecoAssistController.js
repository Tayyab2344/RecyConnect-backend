import { generateTextWithGemini } from '../../../services/geminiChatService.js';
import { sendSuccess, sendError } from '../../../utils/responseHelper.js';
import { logger } from '../../../utils/logger.js';
import prisma from '../../../lib/prisma.js';

/**
 * Handle chat queries for EcoAssist AI Companion.
 * POST /api/app/eco-assist/chat
 */
export async function chatWithEcoAssist(req, res) {
  try {
    const userId = req.user.id;
    const { message, location: clientLocation } = req.body;

    if (!message) {
      return sendError(res, 'Message query is required', null, 400);
    }

    // 1. Fetch complete user context to supply to Gemini prompt
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        role: true,
        ecoPoints: true,
        dailyStreak: true,
        currentLevel: true,
        city: true,
        area: true,
        latitude: true,
        longitude: true
      }
    });

    if (!user) {
      return sendError(res, 'User profile not found', null, 404);
    }

    // Determine current location context
    const currentCity = clientLocation?.city || user.city || 'Abbottabad';
    const currentArea = clientLocation?.area || user.area || 'Jinnahabad';
    const currentLocation = `${currentArea}, ${currentCity}`;

    // Prepare system instructions for Gemini
    const systemPrompt = `You are "EcoAssist", the intelligent AI-powered recycling companion for the RecyConnect application.
You help users navigate the app, complete recycling tasks, discover features, and answer educational queries.
You must analyze the user's message and current context, formulate a warm, helpful, environmentally conscious, and non-robotic response, and output a structured JSON response.

Current User Context:
- User Name: ${user.name || 'User'}
- User Role: ${user.role}
- Current Location: ${currentLocation} (City: ${currentCity}, Area: ${currentArea})
- Eco Points: ${user.ecoPoints}
- Daily Streak: ${user.dailyStreak}
- User Level: ${user.currentLevel}

Rules for parsing navigation intents:
1. "NAVIGATE_SELL_ITEM": Triggered when user wants to list, sell, or post recyclables (e.g., "I want to sell plastic bottles", "sell newspapers", "Mujhe raddi bechni hai", "Mujhe kabari bechna hai").
   - Populate params.category: Choose one of "Plastic", "Paper", "Metal", "Glass", "E-Waste", "Organic Waste" or null.
   - Set params.triggerCamera to true if they want to scan or take a photo, or if it is a general request to sell where a camera classifier is useful.
2. "NAVIGATE_MARKETPLACE": Triggered when user wants to view nearby items, search listings, find buyers/warehouses (e.g., "show cardboard near me", "show e-waste within 5 km", "find warehouses near me", "find highest paying buyer nearby").
   - Populate params.category: Choose one of "Plastic", "Paper", "Metal", "Glass", "E-Waste", "Organic Waste".
   - Populate params.maxDistance: Choose 5, 10, or 25 based on input. Default to 10 if "near me" is asked without distance.
   - Populate params.sortBy: "Nearest First" | "Best Price" | "Most Trusted Seller" | "Recently Listed" | "AI Recommended".
3. "REQUEST_COLLECTOR": Triggered when user wants a pickup request or to call/dispatch a collector (e.g., "request collector", "Mujhe kabaria bulana hai", "pickup request").
   - Set params.autofill to true.
4. "OPEN_REWARDS": Triggered when user asks about eco points, streaks, levels, or rewards.
5. "OPEN_ORDERS": Triggered when user wants to see their orders or listing requests.
6. "SCAN_ITEM": Triggered when user asks to scan, identify waste, or open AI classification scanner.
7. "GENERAL_CHAT": For general recycling queries, greetings, educational inquiries, or off-topic messages.

Urdu / Roman Urdu Support:
- Understand and respond in the user's language (Urdu, Roman Urdu, or English).
- Example: If the user says "Mujhe kabaria bulana hai", reply in Urdu/Roman Urdu: "Ji bilkul! Main aap ke liye pickup request tayyar kar raha hoon." and set intent to REQUEST_COLLECTOR.
- Example: "Mere eco points kitne hain?" -> "Aap ke paas is waqt ${user.ecoPoints} Eco Points hain!" and set intent to OPEN_REWARDS.

Suggestions:
- Provide 1-2 small contextual suggestions/tips in the suggestions array (e.g., "You have ${user.ecoPoints} Eco Points available.", "Plastic prices increased today.", "There are 5 nearby buyers for cardboard.").

You MUST respond strictly in the following JSON format, with no markdown formatting, no code block backticks, and no extra text.
JSON Structure:
{
  "reply": "Friendly text response",
  "intent": {
    "action": "NAVIGATE_SELL_ITEM" | "NAVIGATE_MARKETPLACE" | "REQUEST_COLLECTOR" | "OPEN_REWARDS" | "OPEN_ORDERS" | "SCAN_ITEM" | "GENERAL_CHAT",
    "params": {
      "category": "Plastic" | "Paper" | "Metal" | "Glass" | "E-Waste" | "Organic Waste" | null,
      "maxDistance": 5 | 10 | 25 | null,
      "location": "Abbottabad" | null,
      "sortBy": "Nearest First" | "Best Price" | "Most Trusted Seller" | "Recently Listed" | "AI Recommended" | null,
      "triggerCamera": true | false,
      "autofill": true | false
    }
  },
  "suggestions": ["suggestion 1", "suggestion 2"]
}
`;

    // 2. Call Gemini
    const responseText = await generateTextWithGemini(
      message,
      systemPrompt,
      true // Expecting JSON response MimeType
    );

    let resultJson = null;
    if (responseText) {
      try {
        // Strip out code fences if present (e.g., ```json ... ```)
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
        }
        resultJson = JSON.parse(cleanText);
      } catch (err) {
        logger.warn('Failed to parse EcoAssist JSON response, falling back to heuristics.');
      }
    }

    // 3. Fallback Heuristics Engine (If Gemini API is down, times out, or fails to output valid JSON)
    if (!resultJson) {
      const lowerMsg = message.toLowerCase();
      let replyText = '';
      let action = 'GENERAL_CHAT';
      let category = null;
      let triggerCamera = false;
      let maxDistance = null;
      let sortBy = 'Nearest First';
      let autofill = false;

      // Check for sell item intents
      if (lowerMsg.includes('sell') || lowerMsg.includes('bech') || lowerMsg.includes('listing') || lowerMsg.includes('post')) {
        action = 'NAVIGATE_SELL_ITEM';
        triggerCamera = true;
        replyText = 'Great! Opening the Sell Item screen and launching the camera classification scanner for you.';
        if (lowerMsg.includes('plastic') || lowerMsg.includes('botl') || lowerMsg.includes('bottle')) {
          category = 'Plastic';
          replyText = 'Opening Sell Item screen, preselecting Plastic, and starting the AI camera scanner.';
        } else if (lowerMsg.includes('paper') || lowerMsg.includes('raddi') || lowerMsg.includes('akhbar') || lowerMsg.includes('newspaper')) {
          category = 'Paper';
          replyText = 'Opening Sell Item screen, preselecting Paper, and starting the AI camera scanner.';
        } else if (lowerMsg.includes('cardboard') || lowerMsg.includes('gatta')) {
          category = 'Paper'; // Or cardboard depending on rate mappings
          replyText = 'Opening Sell Item screen, preselecting Paper/Cardboard, and starting the AI camera scanner.';
        } else if (lowerMsg.includes('metal') || lowerMsg.includes('loha') || lowerMsg.includes('copper') || lowerMsg.includes('pittar')) {
          category = 'Metal';
          replyText = 'Opening Sell Item screen, preselecting Metal, and starting the AI camera scanner.';
        }
      } 
      // Check for marketplace search intents
      else if (lowerMsg.includes('show') || lowerMsg.includes('find') || lowerMsg.includes('dhund') || lowerMsg.includes('near') || lowerMsg.includes('marketplace') || lowerMsg.includes('buyer') || lowerMsg.includes('warehouse')) {
        action = 'NAVIGATE_MARKETPLACE';
        maxDistance = 10;
        replyText = `Showing hyperlocal marketplace listings near your location in ${currentCity}.`;
        
        if (lowerMsg.includes('plastic')) category = 'Plastic';
        else if (lowerMsg.includes('paper') || lowerMsg.includes('cardboard') || lowerMsg.includes('gatta')) category = 'Paper';
        else if (lowerMsg.includes('metal') || lowerMsg.includes('loha')) category = 'Metal';
        else if (lowerMsg.includes('e-waste') || lowerMsg.includes('electronics')) category = 'E-Waste';
        else if (lowerMsg.includes('glass')) category = 'Glass';

        if (lowerMsg.includes('5 km') || lowerMsg.includes('5km')) maxDistance = 5;
        else if (lowerMsg.includes('25 km') || lowerMsg.includes('25km')) maxDistance = 25;

        if (lowerMsg.includes('price') || lowerMsg.includes('highest') || lowerMsg.includes('pay')) {
          sortBy = 'Best Price';
          replyText = `Finding the highest paying buyers for ${category || 'recyclables'} in ${currentCity}.`;
        } else if (lowerMsg.includes('trusted') || lowerMsg.includes('trust')) {
          sortBy = 'Most Trusted Seller';
        }
      } 
      // Check for collector dispatch
      else if (lowerMsg.includes('collector') || lowerMsg.includes('kabaria') || lowerMsg.includes('pickup') || lowerMsg.includes('bulana')) {
        action = 'REQUEST_COLLECTOR';
        autofill = true;
        replyText = `Opening the Pickup Request screen and autofilling your location: ${currentLocation}.`;
      } 
      // Check for reward eco points queries
      else if (lowerMsg.includes('point') || lowerMsg.includes('rewards') || lowerMsg.includes('streak') || lowerMsg.includes('level')) {
        action = 'OPEN_REWARDS';
        replyText = `Aap ke paas is waqt **${user.ecoPoints} Eco Points** available hain aur daily streak **${user.dailyStreak} days** hai. Opening your Rewards Board.`;
      } 
      // Check for orders
      else if (lowerMsg.includes('order') || lowerMsg.includes('purchases')) {
        action = 'OPEN_ORDERS';
        replyText = 'Opening your orders ledger.';
      } 
      // Check for image classification scanner
      else if (lowerMsg.includes('scan') || lowerMsg.includes('identify') || lowerMsg.includes('camer')) {
        action = 'SCAN_ITEM';
        replyText = 'Opening the RecyConnect Edge-AI Waste scanner...';
      } 
      // Default conversational reply
      else {
        replyText = `Hello ${user.name}! I am EcoAssist, your AI recycling companion. I can help you sell recyclables, navigate the marketplace, find nearby buyers, or check your Eco Points. How can I help you today?`;
      }

      resultJson = {
        reply: replyText,
        intent: {
          action,
          params: {
            category,
            maxDistance,
            location: currentCity,
            sortBy,
            triggerCamera,
            autofill
          }
        },
        suggestions: [
          `You have ${user.ecoPoints} Eco Points available.`,
          "Plastic prices increased today."
        ]
      };
    }

    sendSuccess(res, 'EcoAssist response generated', resultJson);
  } catch (err) {
    logger.error(`EcoAssist error: ${err.message}`);
    sendError(res, 'Failed to process assistant query', err);
  }
}
