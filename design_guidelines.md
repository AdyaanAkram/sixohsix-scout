{
  "meta": {
    "product_name": "PBG Scout",
    "tagline": "Identify. Evaluate. Develop. Connect.",
    "design_personality": [
      "athletic",
      "organized",
      "community-based",
      "international",
      "trustworthy",
      "professional",
      "field-ready (sunlight legibility first)"
    ],
    "non_goals": [
      "No futuristic/AI aesthetic",
      "No glassmorphism overload",
      "No dark/saturated gradients",
      "No purple"
    ],
    "platform": "mobile-first responsive web app (desktop sidebar + mobile bottom nav)",
    "implementation_note": "Codebase uses .js (not .tsx). Use shadcn/ui components from /src/components/ui/*.jsx."
  },

  "inspiration_fusion": {
    "layout_principles": [
      "Field-ops UI: big touch targets, minimal cognitive load, fast scanning",
      "Thumb-zone primary actions (bottom 35–40% on mobile)",
      "Data-dense desktop tables + mobile card lists",
      "Status-forward UI: badges and progress everywhere"
    ],
    "reference_notes": {
      "segmented_scoring": "Use segmented/toggle-group patterns (Material segmented button principles) for 1–5 ratings; instant feedback; large targets.",
      "mobile_nav": "5-item bottom navigation with labels; active state in navy; subtle top shadow; safe-area padding.",
      "sunlight": "High contrast, avoid low-contrast grays; prefer navy/ink text on warm white; ensure focus rings are visible outdoors."
    }
  },

  "design_tokens": {
    "colors": {
      "usage_priority": [
        "Warm neutral backgrounds",
        "Deep navy for primary actions and headings",
        "Philippine flag accents (red/gold/blue) used sparingly for meaning",
        "Solid colors for content surfaces; gradients only as small decorative section accents"
      ],
      "css_variables": {
        "--background": "36 33% 98%",
        "--foreground": "222 47% 11%",

        "--card": "0 0% 100%",
        "--card-foreground": "222 47% 11%",

        "--popover": "0 0% 100%",
        "--popover-foreground": "222 47% 11%",

        "--primary": "221 83% 16%",
        "--primary-foreground": "0 0% 100%",

        "--secondary": "36 25% 94%",
        "--secondary-foreground": "222 47% 11%",

        "--muted": "36 20% 92%",
        "--muted-foreground": "215 16% 35%",

        "--accent": "210 40% 96%",
        "--accent-foreground": "221 83% 16%",

        "--destructive": "354 78% 44%",
        "--destructive-foreground": "0 0% 100%",

        "--border": "30 14% 86%",
        "--input": "30 14% 86%",
        "--ring": "221 83% 16%",

        "--radius": "0.9rem",

        "--chart-1": "221 83% 16%",
        "--chart-2": "354 78% 44%",
        "--chart-3": "45 93% 47%",
        "--chart-4": "210 90% 35%",
        "--chart-5": "160 55% 35%"
      },
      "named_palette_hex": {
        "navy_950": "#071427",
        "navy_900": "#0B1E3A",
        "navy_800": "#102A4F",
        "ink": "#0F172A",

        "warm_white": "#FBFAF7",
        "sand_50": "#F7F3EA",
        "sand_100": "#EFE7D7",
        "sand_200": "#E6D9C2",

        "flag_red": "#C81D25",
        "flag_gold": "#F4B400",
        "flag_blue": "#1F4AA8",

        "success": "#1F7A4D",
        "warning": "#B45309",
        "info": "#0E7490",
        "neutral_text": "#334155",
        "subtle_text": "#475569",
        "hairline": "#E7E1D6"
      },
      "status_colors": {
        "event": {
          "draft": {"bg": "sand_100", "fg": "ink", "border": "sand_200"},
          "registration_open": {"bg": "#E6F0FF", "fg": "#102A4F", "border": "#BBD6FF"},
          "check_in_open": {"bg": "#FFF7E6", "fg": "#7C2D12", "border": "#FFD9A3"},
          "evaluation_active": {"bg": "#EAF7EF", "fg": "#14532D", "border": "#BFE6CC"},
          "complete": {"bg": "#EEF2FF", "fg": "#1E3A8A", "border": "#C7D2FE"}
        },
        "evaluation": {
          "draft": {"bg": "sand_100", "fg": "ink", "border": "sand_200"},
          "submitted": {"bg": "#E6F0FF", "fg": "#102A4F", "border": "#BBD6FF"},
          "approved": {"bg": "#EAF7EF", "fg": "#14532D", "border": "#BFE6CC"},
          "returned": {"bg": "#FDECEC", "fg": "#7F1D1D", "border": "#F8B4B4"}
        },
        "goal": {
          "not_started": {"bg": "sand_100", "fg": "ink", "border": "sand_200"},
          "active": {"bg": "#E6F0FF", "fg": "#102A4F", "border": "#BBD6FF"},
          "improving": {"bg": "#EAF7EF", "fg": "#14532D", "border": "#BFE6CC"},
          "needs_attention": {"bg": "#FFF7E6", "fg": "#7C2D12", "border": "#FFD9A3"},
          "completed": {"bg": "#EEF2FF", "fg": "#1E3A8A", "border": "#C7D2FE"}
        }
      },
      "allowed_gradients": {
        "rule": "Gradients are decorative only; never on text-heavy surfaces; never exceed 20% viewport; never on small UI elements.",
        "options": [
          {
            "name": "Warm Sand Sweep",
            "css": "linear-gradient(135deg, rgba(244,180,0,0.10) 0%, rgba(200,29,37,0.06) 45%, rgba(31,74,168,0.06) 100%)",
            "usage": "Hero/top header background overlay only (max 160px tall)."
          },
          {
            "name": "Navy Edge Glow",
            "css": "radial-gradient(600px circle at 20% 0%, rgba(16,42,79,0.10), transparent 55%)",
            "usage": "Top-of-page accent behind page title area."
          }
        ]
      }
    },

    "typography": {
      "google_fonts": {
        "heading": {
          "family": "Bebas Neue",
          "fallback": "system-ui",
          "why": "Athletic, condensed, strong for section titles and scoreboard-like headings."
        },
        "body": {
          "family": "IBM Plex Sans",
          "fallback": "system-ui",
          "why": "Highly readable, professional, great numerals for measurements and tables."
        },
        "numbers_optional": {
          "family": "IBM Plex Mono",
          "use": "Optional for bib numbers, station codes, and compact stats chips."
        }
      },
      "tailwind_usage": {
        "app_default": "font-sans text-foreground",
        "heading_class": "font-[\"Bebas_Neue\"] tracking-wide",
        "body_class": "font-[\"IBM_Plex_Sans\"]"
      },
      "type_scale": {
        "h1": "text-4xl sm:text-5xl lg:text-6xl leading-[0.95]",
        "h2": "text-base md:text-lg text-slate-700",
        "section_title": "text-2xl tracking-wide",
        "card_title": "text-lg font-semibold",
        "body": "text-sm sm:text-base",
        "small": "text-xs sm:text-sm"
      }
    },

    "spacing_radius_shadow": {
      "spacing": {
        "page_padding": "px-4 sm:px-6",
        "section_gap": "space-y-6",
        "card_gap": "gap-3 sm:gap-4",
        "touch_target_min": "min-h-12 (48px)"
      },
      "radius": {
        "card": "rounded-2xl",
        "button": "rounded-xl",
        "chip": "rounded-full",
        "input": "rounded-xl"
      },
      "shadow": {
        "card": "shadow-[0_1px_0_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.08)]",
        "sticky_bar": "shadow-[0_-8px_24px_rgba(15,23,42,0.10)]",
        "focus": "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
      }
    }
  },

  "layout_system": {
    "grid": {
      "mobile": "Single column; max content width not constrained (full width) with page padding.",
      "desktop": "12-col grid; left sidebar 260–288px; content max-w-[1200px] with generous gutters.",
      "tables": "Desktop tables use sticky header + row hover; mobile uses card list with key-value rows."
    },
    "navigation": {
      "desktop_sidebar": {
        "items": ["Dashboard", "Evaluation Events", "Players", "Evaluations", "Reports", "Development", "Staff", "Templates", "Settings"],
        "pattern": "Sidebar with grouped sections + small status counters (Badge). Active item uses navy left border + subtle sand background.",
        "data_testid": "desktop-sidebar-nav"
      },
      "mobile_bottom_nav": {
        "items": ["Home", "Events", "Players", "Evaluate", "More"],
        "pattern": "Fixed bottom bar, 5 items with icon + label. Active state: navy icon + label; inactive: slate. Add safe-area padding.",
        "tailwind": "fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80",
        "data_testid": "mobile-bottom-nav"
      }
    }
  },

  "component_path": {
    "shadcn_primary": {
      "button": "/app/frontend/src/components/ui/button.jsx",
      "card": "/app/frontend/src/components/ui/card.jsx",
      "badge": "/app/frontend/src/components/ui/badge.jsx",
      "tabs": "/app/frontend/src/components/ui/tabs.jsx",
      "table": "/app/frontend/src/components/ui/table.jsx",
      "input": "/app/frontend/src/components/ui/input.jsx",
      "textarea": "/app/frontend/src/components/ui/textarea.jsx",
      "select": "/app/frontend/src/components/ui/select.jsx",
      "switch": "/app/frontend/src/components/ui/switch.jsx",
      "toggle_group": "/app/frontend/src/components/ui/toggle-group.jsx",
      "progress": "/app/frontend/src/components/ui/progress.jsx",
      "dialog": "/app/frontend/src/components/ui/dialog.jsx",
      "drawer": "/app/frontend/src/components/ui/drawer.jsx",
      "sheet": "/app/frontend/src/components/ui/sheet.jsx",
      "calendar": "/app/frontend/src/components/ui/calendar.jsx",
      "sonner": "/app/frontend/src/components/ui/sonner.jsx",
      "skeleton": "/app/frontend/src/components/ui/skeleton.jsx",
      "avatar": "/app/frontend/src/components/ui/avatar.jsx",
      "separator": "/app/frontend/src/components/ui/separator.jsx",
      "tooltip": "/app/frontend/src/components/ui/tooltip.jsx",
      "command": "/app/frontend/src/components/ui/command.jsx"
    },
    "recommended_new_components_to_create": [
      {
        "name": "MobileBottomNav",
        "path": "/app/frontend/src/components/navigation/MobileBottomNav.js",
        "notes": "Use lucide-react icons; each button has data-testid; active state uses navy; include safe-area padding."
      },
      {
        "name": "StatusBadge",
        "path": "/app/frontend/src/components/common/StatusBadge.js",
        "notes": "Wrap shadcn Badge with semantic variants for event/evaluation/goal statuses."
      },
      {
        "name": "SaveStatusPill",
        "path": "/app/frontend/src/components/evaluations/SaveStatusPill.js",
        "notes": "Shows Saving/Saved/Offline/Sync Pending with icon + color; used in evaluation top bar."
      },
      {
        "name": "RatingSegment",
        "path": "/app/frontend/src/components/evaluations/RatingSegment.js",
        "notes": "Built on ToggleGroup; 1–5 large segments; supports Not Observed; haptics-like micro animation."
      },
      {
        "name": "PlayerAvatar",
        "path": "/app/frontend/src/components/players/PlayerAvatar.js",
        "notes": "Uses shadcn Avatar; fallback initials; optional bib chip overlay."
      }
    ]
  },

  "page_blueprints": {
    "auth_pages": {
      "sign_in": {
        "layout": "Centered card on warm background; left-aligned text; big primary button.",
        "components": ["Card", "Input", "Button", "Separator"],
        "data_testids": ["sign-in-email-input", "sign-in-password-input", "sign-in-submit-button", "forgot-password-link"]
      },
      "accept_invitation": {
        "layout": "Card with org badge + role; set password flow.",
        "components": ["Card", "Badge", "Input", "Button"],
        "data_testids": ["accept-invite-submit-button"]
      }
    },

    "dashboards": {
      "admin": {
        "top": "Event stats strip (Cards) + quick actions (Create Event, Import CSV, Manage Staff).",
        "components": ["Card", "Button", "Tabs", "Table"],
        "charts": "Recharts: small bar chart for check-in/eval completion."
      },
      "evaluator": {
        "top": "4 focus cards: My Event, My Station, My Group, Continue Evaluating.",
        "pattern": "Each card has a single primary action button; keep copy short; show last saved timestamp.",
        "data_testid": "evaluator-dashboard"
      },
      "head_scout": {
        "top": "Review Queue card with count + Top Players preview list.",
        "components": ["Card", "Badge", "Table", "Button"],
        "data_testid": "head-scout-dashboard"
      }
    },

    "players_directory": {
      "mobile": "Search + filter chips (horizontal scroll) + player cards.",
      "desktop": "Table with sticky header; left column avatar/name; right columns key metrics.",
      "components": ["Input", "Command (optional for search)", "Badge", "Card", "Table"],
      "data_testids": ["players-search-input", "players-filter-button", "players-table"]
    },

    "player_profile": {
      "tabs": ["Overview", "Evaluations", "Development", "Media", "Staff Notes", "Timeline"],
      "overview": {
        "top": "Player header card: avatar, name, bib, positions, status badges.",
        "charts": [
          "Radar chart for skill categories (Recharts RadarChart)",
          "Line chart for score trend"
        ],
        "empty_states": "If no photo: initials avatar; if no data: skeleton + friendly empty copy."
      },
      "development": "Goals list with Progress bars + status badges; coach notes in collapsible cards."
    },

    "events": {
      "events_list": "Cards on mobile; table on desktop; each event card shows status badge + date + location + progress.",
      "event_detail_tabs": ["Overview", "Roster", "Check-In", "Groups", "Stations", "Evaluators", "Live Progress", "Results"],
      "check_in": {
        "mobile": "Search at top + big list rows with Present toggle + bib input.",
        "components": ["Input", "Switch", "Button", "Card"],
        "data_testids": ["check-in-search-input", "check-in-present-toggle", "check-in-bib-input"]
      }
    },

    "evaluation_form_mobile_critical": {
      "screen_goal": "Fast one-handed scoring with clear save state and minimal scrolling.",
      "structure": [
        "Sticky top bar: back, event/station label, SaveStatusPill",
        "Player header: avatar + name + bib + position chips",
        "Skill sections: each has RatingSegment (1–5) + Not Observed toggle",
        "Measurements: numeric inputs with unit suffix",
        "Quick comment chips (tap to append)",
        "Strengths / Development Needs textareas",
        "Prev/Next player sticky footer + Submit button"
      ],
      "sticky_regions": {
        "top": "sticky top-0 bg-[hsl(var(--background))] border-b",
        "bottom": "sticky bottom-[56px] (above bottom nav) bg-white border-t"
      },
      "rating_segment_spec": {
        "component": "ToggleGroup (type=single)",
        "tailwind": "grid grid-cols-5 gap-2",
        "button": "h-14 rounded-xl text-base font-semibold",
        "states": {
          "default": "bg-white border border-[hsl(var(--border))] text-slate-800",
          "hover": "hover:bg-[hsl(var(--secondary))]",
          "selected": "data-[state=on]:bg-[hsl(var(--primary))] data-[state=on]:text-white data-[state=on]:border-transparent",
          "focus": "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        },
        "labels": "Use numeric 1–5; optionally show tiny helper row: 1=Needs work, 3=Average, 5=Elite (Tooltip on info icon).",
        "data_testid_pattern": "rating-{category-key}-toggle-{value}"
      },
      "save_status_pill": {
        "states": {
          "saving": {"label": "Saving", "color": "info"},
          "saved": {"label": "Saved", "color": "success"},
          "offline": {"label": "Offline", "color": "warning"},
          "sync_pending": {"label": "Sync Pending", "color": "flag_gold"}
        },
        "microcopy": "Always show last saved time when available (e.g., 'Saved · 2:14 PM').",
        "data_testid": "evaluation-save-status"
      },
      "pre_submit_checklist": {
        "pattern": "AlertDialog opens on Submit if required fields missing; show checklist with checkboxes.",
        "components": ["AlertDialog", "Checkbox", "Button"],
        "data_testid": "evaluation-submit-checklist"
      }
    },

    "head_scout_review_queue": {
      "layout": "Split view on desktop: queue list left, evaluation detail right. Mobile: list → detail.",
      "compare": "Show evaluator score comparison table + small variance indicator.",
      "actions": "Approve / Return with reason (Dialog).",
      "data_testids": ["review-approve-button", "review-return-button", "review-return-reason-textarea"]
    },

    "reports": {
      "leaderboard": "Table with rank badges; filters in a collapsible panel on mobile.",
      "export": "Buttons: Export CSV / Export PDF (secondary).",
      "data_testids": ["reports-export-csv-button", "reports-export-pdf-button"]
    },

    "csv_import_wizard": {
      "steps": ["Upload", "Preview & Validate", "Confirm", "Summary"],
      "pattern": "Use Tabs or a stepper-like header; show validation errors inline with row highlights.",
      "components": ["Card", "Tabs", "Table", "Alert", "Button"],
      "data_testids": ["csv-upload-input", "csv-preview-table", "csv-confirm-button"]
    }
  },

  "motion_microinteractions": {
    "principles": [
      "Fast feedback: selection changes within 100–150ms",
      "Use subtle scale on press (active:scale-[0.98]) for big buttons",
      "Avoid motion that reduces readability outdoors"
    ],
    "tailwind_patterns": {
      "button": "transition-colors duration-150 active:scale-[0.98]",
      "card_hover_desktop": "transition-shadow duration-200 hover:shadow-[0_2px_0_rgba(15,23,42,0.06),0_14px_34px_rgba(15,23,42,0.10)]",
      "list_row": "transition-colors duration-150 hover:bg-[hsl(var(--secondary))]"
    },
    "optional_library": {
      "framer_motion": {
        "use_cases": ["page transitions", "drawer/sheet entrance", "success checkmark micro animation"],
        "install": "npm i framer-motion",
        "note": "Keep durations short; respect prefers-reduced-motion."
      }
    }
  },

  "charts_recharts": {
    "style": {
      "grid": "Very light gridlines (hairline) or none",
      "stroke_width": 2,
      "dot": "small dots only on active tooltip",
      "colors": {
        "primary_series": "navy_800",
        "secondary_series": "flag_red",
        "accent_series": "flag_gold"
      }
    },
    "empty_state": "If fewer than 2 data points, show a Card with 'No trend yet' and a small hint to complete more evaluations."
  },

  "accessibility": {
    "requirements": [
      "WCAG AA contrast; prefer 10:1 for key text outdoors",
      "Min tap target 44–48px",
      "Visible focus rings on all interactive elements",
      "Do not rely on color alone for status: pair with icon + label",
      "Support prefers-reduced-motion"
    ],
    "forms": {
      "labels": "Always visible labels (not placeholder-only).",
      "errors": "Use Alert component + inline field message; include data-testid on error blocks."
    }
  },

  "image_urls": {
    "note": "Image selector tool unavailable in this environment (provider failure). Use these as guidance; main agent should source royalty-free images later.",
    "categories": [
      {
        "category": "auth_hero_background",
        "description": "Subtle baseball field texture or community practice photo with strong daylight; apply as low-opacity background behind auth card.",
        "urls": []
      },
      {
        "category": "empty_state_illustrations",
        "description": "Simple line illustrations (clipboard, baseball, roster) in navy outline; can be SVGs stored locally.",
        "urls": []
      },
      {
        "category": "player_photos",
        "description": "Player headshots; if missing, use initials avatar pattern.",
        "urls": []
      }
    ]
  },

  "instructions_to_main_agent": {
    "global_css_updates": [
      "Replace CRA default App.css styles; remove centered App-header and spinning logo styles.",
      "Update /src/index.css :root tokens to match the colors.css_variables above (light theme).",
      "Set --radius to 0.9rem for rounded athletic cards.",
      "Add body background as warm neutral (bg-background already)."
    ],
    "component_conventions": [
      "Use shadcn/ui components from /src/components/ui/*.jsx; avoid raw HTML dropdown/calendar/toast.",
      "All interactive elements and key info must include data-testid in kebab-case.",
      "Prefer Card + Badge + Button patterns; keep mobile lists as cards; desktop as tables."
    ],
    "evaluation_form_build_notes": [
      "Implement sticky top bar with SaveStatusPill and offline/sync states.",
      "Use ToggleGroup for 1–5 rating segments; large h-14 buttons; grid-cols-5.",
      "Add sticky footer above bottom nav for Prev/Next + Submit.",
      "Use AlertDialog for pre-submit checklist when required fields missing."
    ],
    "data_testid_examples": [
      "mobile-bottom-nav-evaluate",
      "event-status-badge",
      "player-card-open-button",
      "evaluation-save-status",
      "rating-throwing-toggle-5",
      "evaluation-submit-button"
    ]
  },

  "appendix_general_ui_ux_design_guidelines": "<General UI UX Design Guidelines>  \n    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms\n    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text\n   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json\n\n **GRADIENT RESTRICTION RULE**\nNEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc\nNEVER use dark gradients for logo, testimonial, footer etc\nNEVER let gradients cover more than 20% of the viewport.\nNEVER apply gradients to text-heavy content or reading areas.\nNEVER use gradients on small UI elements (<100px width).\nNEVER stack multiple gradient layers in the same viewport.\n\n**ENFORCEMENT RULE:**\n    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors\n\n**How and where to use:**\n   • Section backgrounds (not content backgrounds)\n   • Hero section header content. Eg: dark to light to dark color\n   • Decorative overlays and accent elements only\n   • Hero section with 2-3 mild color\n   • Gradients creation can be done for any angle say horizontal, vertical or diagonal\n\n- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**\n\n</Font Guidelines>\n\n- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. \n   \n- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.\n\n- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.\n   \n- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly\n    Eg: - if it implies playful/energetic, choose a colorful scheme\n           - if it implies monochrome/minimal, choose a black–white/neutral scheme\n\n**Component Reuse:**\n\t- Prioritize using pre-existing components from src/components/ui when applicable\n\t- Create new components that match the style and conventions of existing components when needed\n\t- Examine existing components to understand the project's component patterns before creating new ones\n\n**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component\n\n**Best Practices:**\n\t- Use Shadcn/UI as the primary component library for consistency and accessibility\n\t- Import path: ./components/[component-name]\n\n**Export Conventions:**\n\t- Components MUST use named exports (export const ComponentName = ...)\n\t- Pages MUST use default exports (export default function PageName() {...})\n\n**Toasts:**\n  - Use `sonner` for toasts\"\n  - Sonner component are located in `/app/src/components/ui/sonner.tsx`\n\nUse 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.\n</General UI UX Design Guidelines>"
}
