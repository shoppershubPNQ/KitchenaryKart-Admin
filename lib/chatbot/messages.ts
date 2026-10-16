/**
 * Customer-facing chatbot messages (English and Hindi) and the WhatsApp / call
 * handoff. The widget shows `reply` for EVERY response, so every error code
 * has a fixed, friendly text here - an error reply is never built from an
 * exception message. A key problem is never mentioned to the customer; they
 * only see the "unavailable" text.
 *
 * Phone / WhatsApp +91 98903 52455 and hours Mon-Sat 10 am-7 pm IST are the
 * site's published contact details (web/components/Footer.tsx,
 * web/app/contact/page.tsx, web/lib/json-ld.ts).
 *
 * No imports: pure data, safe anywhere.
 */

export type ErrorCode =
  | 'invalid_request'
  | 'too_long'
  | 'forbidden_origin'
  | 'disabled'
  | 'unavailable'
  | 'rate_limited'
  | 'daily_cap'
  | 'session_cap'
  | 'busy'
  | 'upstream_busy'
  | 'refused'
  | 'error';

export interface Handoff {
  whatsappUrl: string;
  phoneDisplay: string;
  telUrl: string;
  hours: string;
}

type MsgKey = Exclude<ErrorCode, 'forbidden_origin'> | 'errorAfterLead' | 'priceFallback' | 'discountFallback';
export type Messages = Record<MsgKey | 'forbidden_origin', string>;

const EN: Record<MsgKey, string> = {
  disabled: "Our chat assistant is not available right now. Please WhatsApp us on +91 98903 52455 or call us (Mon–Sat, 10 am–7 pm IST).",
  unavailable: "Sorry, our chat assistant is offline at the moment. Please WhatsApp us on +91 98903 52455 and our team will help you (Mon–Sat, 10 am–7 pm IST).",
  daily_cap: "Our chat assistant has reached its limit for today. Please WhatsApp us on +91 98903 52455 or call us, and our team will help you.",
  session_cap: "This chat has reached its message limit. Tap \"New chat\" to start again, or WhatsApp us on +91 98903 52455.",
  rate_limited: "You're sending messages very quickly. Please wait a few minutes and try again, or WhatsApp us on +91 98903 52455.",
  upstream_busy: "Our assistant is very busy right now. Please try again in a minute, or WhatsApp us on +91 98903 52455.",
  busy: "Please wait for the reply to your previous message.",
  too_long: "Please keep your message under 1,000 characters.",
  invalid_request: "Sorry, I couldn't read that message. Please type it again.",
  refused: "Sorry, I can't help with that here. I'm happy to help with our products, prices or your order - or you can WhatsApp our team on +91 98903 52455.",
  error: "Sorry, something went wrong on our side. Please try again in a moment, or WhatsApp us on +91 98903 52455.",
  errorAfterLead: "Your details have reached our team, and they will contact you during working hours (Mon–Sat, 10 am–7 pm IST). Sorry, I couldn't finish my reply - you can also WhatsApp us on +91 98903 52455.",
  priceFallback: "For the exact price of this item, please check the product page or WhatsApp our team on +91 98903 52455 - they'll confirm it for you.",
  discountFallback: "Any discount or special price is confirmed by our team personally. Please WhatsApp us on +91 98903 52455 or use the buttons below - they'll help you.",
};

const HI: Record<MsgKey, string> = {
  disabled: "हमारा चैट असिस्टेंट अभी उपलब्ध नहीं है। कृपया +91 98903 52455 पर WhatsApp करें या कॉल करें (सोम–शनि, सुबह 10 से शाम 7 बजे)।",
  unavailable: "माफ़ कीजिए, हमारा चैट असिस्टेंट अभी ऑफ़लाइन है। कृपया +91 98903 52455 पर WhatsApp करें, हमारी टीम आपकी मदद करेगी (सोम–शनि, सुबह 10 से शाम 7 बजे)।",
  daily_cap: "आज के लिए हमारे चैट असिस्टेंट की सीमा पूरी हो गई है। कृपया +91 98903 52455 पर WhatsApp या कॉल करें, हमारी टीम आपकी मदद करेगी।",
  session_cap: "इस चैट में संदेशों की सीमा पूरी हो गई है। दोबारा शुरू करने के लिए \"New chat\" दबाएँ, या +91 98903 52455 पर WhatsApp करें।",
  rate_limited: "आप बहुत जल्दी-जल्दी संदेश भेज रहे हैं। कृपया कुछ मिनट रुककर फिर कोशिश करें, या +91 98903 52455 पर WhatsApp करें।",
  upstream_busy: "हमारा असिस्टेंट अभी बहुत व्यस्त है। कृपया एक मिनट बाद फिर कोशिश करें, या +91 98903 52455 पर WhatsApp करें।",
  busy: "कृपया अपने पिछले संदेश के जवाब का इंतज़ार करें।",
  too_long: "कृपया अपना संदेश 1,000 अक्षरों से छोटा रखें।",
  invalid_request: "माफ़ कीजिए, यह संदेश पढ़ा नहीं जा सका। कृपया दोबारा लिखें।",
  refused: "माफ़ कीजिए, इसमें यहाँ मदद संभव नहीं है। हमारे प्रोडक्ट, कीमत या आपके ऑर्डर के बारे में ज़रूर पूछिए - या +91 98903 52455 पर हमारी टीम को WhatsApp करें।",
  error: "माफ़ कीजिए, हमारी तरफ़ से कुछ गड़बड़ हो गई। कृपया थोड़ी देर में फिर कोशिश करें, या +91 98903 52455 पर WhatsApp करें।",
  errorAfterLead: "आपकी जानकारी हमारी टीम तक पहुँच गई है, टीम काम के समय (सोम–शनि, सुबह 10 से शाम 7 बजे) आपसे संपर्क करेगी। माफ़ कीजिए, जवाब पूरा नहीं हो सका - आप +91 98903 52455 पर WhatsApp भी कर सकते हैं।",
  priceFallback: "इस प्रोडक्ट की सही कीमत के लिए कृपया प्रोडक्ट पेज देखें या +91 98903 52455 पर हमारी टीम को WhatsApp करें - टीम आपको पुष्टि कर देगी।",
  discountFallback: "कोई भी डिस्काउंट या स्पेशल कीमत हमारी टीम ख़ुद तय करती है। कृपया +91 98903 52455 पर WhatsApp करें या नीचे दिए बटन इस्तेमाल करें - टीम आपकी मदद करेगी।",
};

/** A blocked origin sees the same "offline" text as a missing key. */
export const MSG_EN: Messages = { ...EN, forbidden_origin: EN.unavailable };
export const MSG_HI: Messages = { ...HI, forbidden_origin: HI.unavailable };

/** Hindi when the customer's message contains Devanagari, otherwise English. */
export const isHindi = (text: string | null | undefined): boolean => /[ऀ-ॿ]/.test(text ?? '');
export const messagesFor = (hindi: boolean): Messages => (hindi ? MSG_HI : MSG_EN);

/** HTTP status per error code (the widget reads the JSON whatever the status). */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  too_long: 400,
  forbidden_origin: 403,
  disabled: 503,
  unavailable: 503,
  rate_limited: 429,
  daily_cap: 429,
  session_cap: 429,
  upstream_busy: 429,
  busy: 409,
  refused: 200,
  error: 200,
};

/** Whether an error response carries the WhatsApp / call buttons. */
export const HANDOFF_FOR: Record<ErrorCode, boolean> = {
  invalid_request: false,
  too_long: false,
  forbidden_origin: true,
  disabled: true,
  unavailable: true,
  rate_limited: true,
  daily_cap: true,
  session_cap: true,
  upstream_busy: true,
  busy: false,
  refused: true,
  error: true,
};

export const TEAM_PHONE_DISPLAY = '+91 98903 52455';
export const TEAM_HOURS_SHORT = 'Mon–Sat, 10 am–7 pm IST';
export const TEAM_HOURS_LONG = 'Monday to Saturday, 10 am to 7 pm IST';
export const TEAM_EMAIL = 'support@kitchenarykart.com';

/** WhatsApp + call buttons. The optional summary pre-fills the WhatsApp text;
 *  links and long digit runs (phone numbers) are stripped from it first. */
export function buildHandoff(summary?: string): Handoff {
  const clean = (summary ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\d[\d\s-]{6,}\d/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 300);
  const text = `Hi, I was chatting with the Kitchenary Kart website assistant.${clean ? ' ' + clean : ' I need help from the team.'}`;
  return {
    whatsappUrl: `https://wa.me/919890352455?text=${encodeURIComponent(text)}`,
    phoneDisplay: TEAM_PHONE_DISPLAY,
    telUrl: 'tel:+919890352455',
    hours: TEAM_HOURS_SHORT,
  };
}
