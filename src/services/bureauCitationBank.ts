export interface CitationEntry { citation:string; shortForm:string; proseForm:string; passCompatibility:number[]; frivolousRisk:'safe'|'moderate'|'risky' }
export interface BureauCitationProfile { bureau:string; frivolousRiskLevel:'low'|'medium'|'high'; preferredCitations:CitationEntry[]; avoidAfterRepeat:number; safeLeadCitation:string }
const common:CitationEntry[]=[
 {citation:'15 U.S.C. § 1681i(a)(1)',shortForm:'§ 1681i(a)(1)',proseForm:'the statutory right to reinvestigation',passCompatibility:[1,2],frivolousRisk:'safe'},
 {citation:'15 U.S.C. § 1681i(a)(6)',shortForm:'§ 1681i(a)(6)',proseForm:'the bureau notification obligation',passCompatibility:[2,3,4],frivolousRisk:'safe'},
 {citation:'15 U.S.C. § 1681i(a)(7)',shortForm:'§ 1681i(a)(7)',proseForm:'the description-of-procedure requirement',passCompatibility:[3,4],frivolousRisk:'safe'},
 {citation:'15 U.S.C. § 1681e(b)',shortForm:'§ 1681e(b)',proseForm:'the maximum-possible-accuracy obligation',passCompatibility:[1,2,3],frivolousRisk:'safe'},
 {citation:'12 C.F.R. § 1022.43',shortForm:'§ 1022.43',proseForm:'the direct-dispute accuracy regulation',passCompatibility:[3,4,5],frivolousRisk:'moderate'},
];
export const BUREAU_CITATION_PROFILES:Record<string,BureauCitationProfile>={Experian:{bureau:'Experian',frivolousRiskLevel:'high',avoidAfterRepeat:1,safeLeadCitation:common[0].citation,preferredCitations:common},Equifax:{bureau:'Equifax',frivolousRiskLevel:'medium',avoidAfterRepeat:2,safeLeadCitation:common[0].citation,preferredCitations:common},TransUnion:{bureau:'TransUnion',frivolousRiskLevel:'medium',avoidAfterRepeat:2,safeLeadCitation:common[0].citation,preferredCitations:common}};
export function selectCitation(bureau:string,pass:number,previous:string[]=[]):CitationEntry { const key=Object.keys(BUREAU_CITATION_PROFILES).find(k=>k.toLowerCase()===bureau.toLowerCase())??'Equifax'; const profile=BUREAU_CITATION_PROFILES[key]; const compatible=profile.preferredCitations.filter(c=>c.passCompatibility.includes(pass)); return compatible.find(c=>!previous.includes(c.citation))??compatible[0]??profile.preferredCitations[0]; }
