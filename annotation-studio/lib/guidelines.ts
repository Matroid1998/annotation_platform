// Transcribed from the supplied guideline PDFs. Contains no answer key.
export const CRITERIA = [
  {
    "id": "grounding",
    "name": "Grounding",
    "description": "Grounding means that the document supports the answer and the factual assumptions in the question. Preserve who must act, what is required or permitted, and conditions and exceptions. A proposal is not an adopted decision. A statement presented for checking need not be true, but its answer must resolve it correctly. An important unsupported assertion merits at most 2; no support for the central answer merits 1.",
    "chemistryDescription": "Grounding means that the document supports the answer and the factual assumptions in the question. Check chemical identities, conditions and the distinction between proposed uses and demonstrated effects. An exact quotation may answer the wrong question. Give at most 2 for an important unsupported statement. A statement presented for checking need not be true.",
    "question": "Are the question and answer supported by the text?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "precision",
    "name": "Precision",
    "description": "Precision means including the evidence needed to answer the question, with essential qualifications and no unnecessary material. Keep conditions and exceptions, even if they lengthen the answer. Use one unbroken passage; identify a shorter sufficient passage before penalizing excess. A missing essential qualification merits at most 2; absence of the main information merits 1. Judge this separately from factual correctness.",
    "chemistryDescription": "Precision means including the evidence needed to answer the question, with essential qualifications and no unnecessary material. Deduct for excess only if a shorter continuous extract suffices. Give 3 for minor excess and at most 2 for a decisive omission.",
    "question": "Does the answer include the right amount of evidence?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "numerical_fidelity",
    "name": "Numerical fidelity",
    "description": "Numerical fidelity means preserving numbers and references accurately, including their meaning in context. Check dates, units, percentages, limits and the event from which a period runs. A changed value or meaning merits at most 2; an invented or contradicted central value merits 1. Hypothetical values and values proposed for checking are not automatically errors. If no relevant number or reference occurs, record 4 and “not applicable”.",
    "chemistryDescription": "Numerical fidelity means preserving numbers and references accurately, including their meaning in context. Check values, units, ranges, substances, stages and percentage bases. Give at most 2 for an important change. If inapplicable, enter 4 and “not applicable.” Assess missing requested numbers under checks 1 and 2.",
    "question": "Are numbers and references accurate?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "search_realism",
    "name": "Search realism",
    "description": "Search realism is the plausibility of a question as a real request for information. Judge whether it serves a recognizable legal need, rather than tests recognition of words. Simple requests can be useful; give no extra credit for length, difficulty or public importance. A plausible need merits 4; a largely pointless request merits 1–2.",
    "chemistryDescription": "Search realism is the plausibility of a question as a real request for information. Consider whether a researcher or practitioner would seek it. Simple questions can succeed fully. A question stating its complete answer seeks nothing new. Judge this separately from the answer’s success.",
    "question": "Would an expert reasonably need this information?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "standalone_clarity",
    "name": "Standalone clarity",
    "description": "Standalone clarity means the question can be understood without seeing the source document. Check that it identifies the legal setting, actors and information sought. Require conditions, territory or time only when necessary. Sufficient context merits 4; broad but usable context may merit 3. Missing an essential distinction merits at most 2; an unidentifiable subject merits 1.",
    "chemistryDescription": "Standalone clarity means the question can be understood without seeing the source document. Check that it identifies the subject, conditions and information sought without relying on an unseen formula, drawing or passage. A named chemical class may suffice. Give at most 2 for essential missing context; 1 for an unidentifiable subject.",
    "question": "Is the question understandable on its own?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "information_value",
    "name": "Information value",
    "description": "Information value is the extent to which the answer provides what the question asks for. Check that it addresses every requested part. A retention period does not identify which entries must be recorded. Repeating the question does not answer it. A complete response merits 4; a useful answer with a small omission may merit 3. A missing important part merits at most 2; absent central information merits 1.",
    "chemistryDescription": "Information value is the extent to which the answer provides what the question asks for. Check every requested detail and necessary condition for the same subject; related facts alone are insufficient. Give at most 2 if an important part is missing; 1 if the main question is unanswered. Do not demand explanation beyond what answers the request.",
    "question": "Does the answer provide the information asked for?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "focus_formulation",
    "name": "Focus and formulation",
    "description": "Focus and formulation describe how clearly a question expresses one purpose, using only the wording needed. Allow connected parts, but require a clear request rather than a list of topics. Avoid unnecessary background and extensive copying of ordinary source wording. Keep necessary legal terms; do not penalize answers for quoting. A focused question merits 4; loose wording may merit 3; a diffuse request merits 1–2.",
    "chemistryDescription": "Focus and formulation describe how clearly a question expresses one purpose, using only the wording needed. Allow connected details in one request. Identify specific repetition or unrelated demands before deducting. Judge the question’s wording, not the answer’s length. Keep necessary chemical names.",
    "question": "Does the question make one clear, focused request?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  },
  {
    "id": "linguistic_quality",
    "name": "Linguistic quality",
    "description": "Linguistic quality is the correctness and naturalness of the question’s language. Assess grammar, sentence structure and terminology in the original language for a reader with appropriate legal knowledge. Correct professional writing merits 4; understandable but awkward wording may merit 3; language that seriously hinders understanding merits 1–2. Do not lower this score solely for a factual error or old-fashioned wording in a quoted source.",
    "chemistryDescription": "Linguistic quality is the correctness and naturalness of the question’s language. Assess grammar, terminology and sentence structure in its original language. Give 4 for clear ordinary writing, 3 for a specific awkward expression, 2 for language that impedes reading, or 1 if unintelligible. Do not deduct solely for an unsupported answer or copied language errors.",
    "question": "Is the language clear and natural?",
    "anchors": {
      "5": "Fully successful, with no weakness and a specific strength beyond ordinary good work. Explain that strength.",
      "4": "Fully successful and reliable. A correct, polished result can receive 4 without any defect; a minor limitation may also fit here.",
      "3": "Basically useful but only serviceable, or with a meaningful limitation that does not make it unusable.",
      "2": "A major problem requires substantial correction.",
      "1": "The requirement is not met, or central information is missing."
    }
  }
];
export const QUESTIONS = [
  {
    "id": "1",
    "question": "For an item you can assess, what must you record?",
    "options": [
      {
        "value": "A",
        "label": "One overall 1–5 score"
      },
      {
        "value": "B",
        "label": "Eight scores without reasons"
      },
      {
        "value": "C",
        "label": "Eight 1–5 scores, reasons and needed corrections"
      },
      {
        "value": "D",
        "label": "A rewritten question and answer only"
      }
    ]
  },
  {
    "id": "2",
    "question": "How should you distinguish scores 4 and 5?",
    "options": [
      {
        "value": "A",
        "label": "4: fully successful; 5: an explained exceptional strength"
      },
      {
        "value": "B",
        "label": "4: flawed; 5: error-free"
      },
      {
        "value": "C",
        "label": "4: simple; 5: difficult"
      },
      {
        "value": "D",
        "label": "4 and 5 mean the same thing"
      }
    ]
  },
  {
    "id": "3",
    "question": "How should an important unsupported assertion affect scoring?",
    "options": [
      {
        "value": "A",
        "label": "Give every criterion 1"
      },
      {
        "value": "B",
        "label": "Give Grounding 3 and leave other scores unchanged"
      },
      {
        "value": "C",
        "label": "Mark every criterion “cannot assess”"
      },
      {
        "value": "D",
        "label": "Give Grounding at most 2; judge other criteria separately"
      }
    ]
  },
  {
    "id": "4",
    "question": "No relevant numbers or references apply. What do you record for Numerical fidelity?",
    "options": [
      {
        "value": "A",
        "label": "1"
      },
      {
        "value": "B",
        "label": "4 and “not applicable”"
      },
      {
        "value": "C",
        "label": "5"
      },
      {
        "value": "D",
        "label": "“Cannot assess”"
      }
    ]
  },
  {
    "id": "5",
    "question": "When should you use “cannot assess”?",
    "options": [
      {
        "value": "A",
        "label": "The answer is known to be unsupported"
      },
      {
        "value": "B",
        "label": "The wording is poor"
      },
      {
        "value": "C",
        "label": "Any score would be below 4"
      },
      {
        "value": "D",
        "label": "Needed material or expertise is missing; explain why"
      }
    ]
  },
  {
    "id": "6",
    "question": "What do you use to judge factual support and Linguistic quality, respectively?",
    "options": [
      {
        "value": "A",
        "label": "Supplied text; the question’s original language"
      },
      {
        "value": "B",
        "label": "Supplied text; an English translation only"
      },
      {
        "value": "C",
        "label": "Outside sources; the original language"
      },
      {
        "value": "D",
        "label": "Outside sources; an English translation only"
      }
    ]
  },
  {
    "id": "7",
    "question": "When checking whether a question stands on its own, how should you handle missing context?",
    "options": [
      {
        "value": "A",
        "label": "Fill it in from the document"
      },
      {
        "value": "B",
        "label": "Assume the most likely subject"
      },
      {
        "value": "C",
        "label": "Judge only the information in the question"
      },
      {
        "value": "D",
        "label": "Ignore missing context if the grammar is correct"
      }
    ]
  },
  {
    "id": "8",
    "question": "Before lowering a score because an answer is too long, what should you check?",
    "options": [
      {
        "value": "A",
        "label": "Whether it exceeds a fixed word limit"
      },
      {
        "value": "B",
        "label": "Whether a shorter continuous passage preserves all needed information and qualifications"
      },
      {
        "value": "C",
        "label": "Whether another answer is shorter"
      },
      {
        "value": "D",
        "label": "Whether technical terms can be removed"
      }
    ]
  },
  {
    "id": "9",
    "question": "What should a useful explanation of a score include?",
    "options": [
      {
        "value": "A",
        "label": "The score number repeated in words"
      },
      {
        "value": "B",
        "label": "A general impression such as “good” or “bad”"
      },
      {
        "value": "C",
        "label": "A specific strength or problem relevant to that criterion"
      },
      {
        "value": "D",
        "label": "A comparison with the previous item"
      }
    ]
  },
  {
    "id": "10",
    "question": "What should you do when an answer provides only part of the requested information?",
    "options": [
      {
        "value": "A",
        "label": "Give full marks because the supplied facts are correct"
      },
      {
        "value": "B",
        "label": "Identify what is missing and lower the affected scores appropriately"
      },
      {
        "value": "C",
        "label": "Give every criterion 1"
      },
      {
        "value": "D",
        "label": "Use “cannot assess” for every criterion"
      }
    ]
  }
];
export const GUIDELINE_VERSION = "supplied-pdf-2026-11-03";
