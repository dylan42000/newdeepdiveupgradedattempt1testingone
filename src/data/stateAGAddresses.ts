/**
 * State Attorney General Contact Database
 * Used for Round 4 regulatory triple strike — filing complaints with state AGs
 * alongside CFPB complaints for maximum regulatory pressure.
 */

export interface StateAGAddress {
  state: string;
  stateCode: string;
  agName?: string;
  office: string;
  address: string;
  city: string;
  stateAbbr: string;
  zip: string;
  phone: string;
  complaintUrl: string;
  notes?: string;
}

export const STATE_AG_ADDRESSES: Record<string, StateAGAddress> = {
  AL: { state: 'Alabama', stateCode: 'AL', office: 'Office of the Attorney General of Alabama', address: '501 Washington Ave', city: 'Montgomery', stateAbbr: 'AL', zip: '36104', phone: '(334) 242-7300', complaintUrl: 'https://www.alabamaag.gov/consumer-protection/' },
  AK: { state: 'Alaska', stateCode: 'AK', office: 'Alaska Department of Law', address: '1031 W 4th Ave Ste 200', city: 'Anchorage', stateAbbr: 'AK', zip: '99501', phone: '(907) 269-5100', complaintUrl: 'https://www.law.alaska.gov/department/civil/consumer/ConsumerProtectionfaq.html' },
  AZ: { state: 'Arizona', stateCode: 'AZ', office: 'Arizona Attorney General', address: '2005 N Central Ave', city: 'Phoenix', stateAbbr: 'AZ', zip: '85004', phone: '(602) 542-5763', complaintUrl: 'https://www.azag.gov/consumer-complaints' },
  AR: { state: 'Arkansas', stateCode: 'AR', office: 'Arkansas Attorney General', address: '323 Center St Ste 200', city: 'Little Rock', stateAbbr: 'AR', zip: '72201', phone: '(501) 682-2007', complaintUrl: 'https://arkansasag.gov/consumer-protection/resources/file-a-complaint/' },
  CA: { state: 'California', stateCode: 'CA', office: 'California Department of Justice', address: 'PO Box 944255', city: 'Sacramento', stateAbbr: 'CA', zip: '94244-2550', phone: '(800) 952-5225', complaintUrl: 'https://oag.ca.gov/consumers/fileacomplaint' },
  CO: { state: 'Colorado', stateCode: 'CO', office: 'Colorado Attorney General', address: '1300 Broadway 10th Floor', city: 'Denver', stateAbbr: 'CO', zip: '80203', phone: '(720) 508-6000', complaintUrl: 'https://coag.gov/file-a-complaint/' },
  CT: { state: 'Connecticut', stateCode: 'CT', office: 'Connecticut Attorney General', address: '165 Capitol Ave', city: 'Hartford', stateAbbr: 'CT', zip: '06106', phone: '(860) 808-5318', complaintUrl: 'https://www.dir.ct.gov/ag/complaint.htm' },
  DE: { state: 'Delaware', stateCode: 'DE', office: 'Delaware Department of Justice', address: 'Carvel State Office Bldg, 820 N French St', city: 'Wilmington', stateAbbr: 'DE', zip: '19801', phone: '(302) 577-8600', complaintUrl: 'https://ago.delaware.gov/fraud-consumer-protection/consumer-protection/' },
  FL: { state: 'Florida', stateCode: 'FL', office: 'Florida Department of Legal Affairs', address: 'PL-01 The Capitol', city: 'Tallahassee', stateAbbr: 'FL', zip: '32399-1050', phone: '(850) 414-3990', complaintUrl: 'https://www.myfloridalegal.com/file-a-complaint' },
  GA: { state: 'Georgia', stateCode: 'GA', office: 'Georgia Department of Law', address: '40 Capitol Square SW', city: 'Atlanta', stateAbbr: 'GA', zip: '30334', phone: '(404) 656-3300', complaintUrl: 'https://law.georgia.gov/consumer-protection-division' },
  HI: { state: 'Hawaii', stateCode: 'HI', office: 'Hawaii Attorney General', address: '425 Queen St', city: 'Honolulu', stateAbbr: 'HI', zip: '96813', phone: '(808) 586-1500', complaintUrl: 'https://cca.hawaii.gov/rico/consumer-complaint-form/' },
  ID: { state: 'Idaho', stateCode: 'ID', office: 'Idaho Attorney General', address: '700 W Jefferson St Ste 210', city: 'Boise', stateAbbr: 'ID', zip: '83720-0010', phone: '(208) 334-2424', complaintUrl: 'https://www.ag.idaho.gov/consumer-protection/consumer-complaints/' },
  IL: { state: 'Illinois', stateCode: 'IL', office: 'Illinois Attorney General', address: '100 W Randolph St', city: 'Chicago', stateAbbr: 'IL', zip: '60601', phone: '(312) 814-3000', complaintUrl: 'https://illinoisattorneygeneral.gov/consumers/fileacomplaint.html' },
  IN: { state: 'Indiana', stateCode: 'IN', office: 'Indiana Attorney General', address: 'Indiana Government Center South, 302 W Washington St 5th Floor', city: 'Indianapolis', stateAbbr: 'IN', zip: '46204', phone: '(800) 382-5516', complaintUrl: 'https://www.in.gov/attorneygeneral/consumer-protection-division/file-a-consumer-complaint-with-our-office/' },
  IA: { state: 'Iowa', stateCode: 'IA', office: 'Iowa Attorney General', address: 'Hoover Bldg, 1305 E Walnut St', city: 'Des Moines', stateAbbr: 'IA', zip: '50319', phone: '(515) 281-5926', complaintUrl: 'https://www.iowaattorneygeneral.gov/for-consumers/file-a-consumer-complaint' },
  KS: { state: 'Kansas', stateCode: 'KS', office: 'Kansas Attorney General', address: '120 SW 10th Ave', city: 'Topeka', stateAbbr: 'KS', zip: '66612', phone: '(785) 296-3751', complaintUrl: 'https://ag.ks.gov/about-the-office/sections-and-divisions/consumer-protection' },
  KY: { state: 'Kentucky', stateCode: 'KY', office: 'Kentucky Attorney General', address: '700 Capitol Ave Ste 118', city: 'Frankfort', stateAbbr: 'KY', zip: '40601', phone: '(502) 696-5300', complaintUrl: 'https://ag.ky.gov/complaints/Pages/default.aspx' },
  LA: { state: 'Louisiana', stateCode: 'LA', office: 'Louisiana Department of Justice', address: 'PO Box 94005', city: 'Baton Rouge', stateAbbr: 'LA', zip: '70804-9005', phone: '(800) 351-4889', complaintUrl: 'https://www.ag.state.la.us/ConsumerComplaint' },
  ME: { state: 'Maine', stateCode: 'ME', office: 'Maine Attorney General', address: '6 State House Station', city: 'Augusta', stateAbbr: 'ME', zip: '04333-0006', phone: '(207) 626-8800', complaintUrl: 'https://www.maine.gov/ag/consumer/complaints/' },
  MD: { state: 'Maryland', stateCode: 'MD', office: 'Maryland Attorney General', address: '200 St Paul Pl', city: 'Baltimore', stateAbbr: 'MD', zip: '21202-2021', phone: '(410) 528-8662', complaintUrl: 'https://www.marylandattorneygeneral.gov/Pages/CPD/get-help.aspx' },
  MA: { state: 'Massachusetts', stateCode: 'MA', office: 'Massachusetts Attorney General', address: 'One Ashburton Pl', city: 'Boston', stateAbbr: 'MA', zip: '02108', phone: '(617) 963-2000', complaintUrl: 'https://www.mass.gov/consumer-complaints' },
  MI: { state: 'Michigan', stateCode: 'MI', office: 'Michigan Attorney General', address: 'PO Box 30212', city: 'Lansing', stateAbbr: 'MI', zip: '48909-7712', phone: '(517) 335-7622', complaintUrl: 'https://www.michigan.gov/ag/consumer-protection/file-a-consumer-complaint' },
  MN: { state: 'Minnesota', stateCode: 'MN', office: 'Minnesota Attorney General', address: '445 Minnesota St Ste 1400', city: 'Saint Paul', stateAbbr: 'MN', zip: '55101-2131', phone: '(651) 296-3353', complaintUrl: 'https://www.ag.state.mn.us/Consumer/PubConsumerAssistForm.asp' },
  MS: { state: 'Mississippi', stateCode: 'MS', office: 'Mississippi Attorney General', address: 'PO Box 220', city: 'Jackson', stateAbbr: 'MS', zip: '39205-0220', phone: '(800) 281-4418', complaintUrl: 'https://www.ago.state.ms.us/divisions/consumer-protection/' },
  MO: { state: 'Missouri', stateCode: 'MO', office: 'Missouri Attorney General', address: 'PO Box 899', city: 'Jefferson City', stateAbbr: 'MO', zip: '65102', phone: '(800) 392-8222', complaintUrl: 'https://ago.mo.gov/consumer-complaints/file-a-complaint' },
  MT: { state: 'Montana', stateCode: 'MT', office: 'Montana Attorney General', address: 'PO Box 201401', city: 'Helena', stateAbbr: 'MT', zip: '59620-1401', phone: '(406) 444-2026', complaintUrl: 'https://dojmt.gov/consumer/consumer-complaints/' },
  NE: { state: 'Nebraska', stateCode: 'NE', office: 'Nebraska Attorney General', address: '2115 State Capitol', city: 'Lincoln', stateAbbr: 'NE', zip: '68509', phone: '(402) 471-2682', complaintUrl: 'https://ago.nebraska.gov/consumer-protection/file-consumer-complaint' },
  NV: { state: 'Nevada', stateCode: 'NV', office: 'Nevada Attorney General', address: '100 N Carson St', city: 'Carson City', stateAbbr: 'NV', zip: '89701-4717', phone: '(702) 486-3132', complaintUrl: 'https://ag.nv.gov/Complaints/File_Complaint/' },
  NH: { state: 'New Hampshire', stateCode: 'NH', office: 'New Hampshire Attorney General', address: 'NH Dept of Justice, 33 Capitol St', city: 'Concord', stateAbbr: 'NH', zip: '03301', phone: '(603) 271-3641', complaintUrl: 'https://www.doj.nh.gov/consumer-protection/complaints.htm' },
  NJ: { state: 'New Jersey', stateCode: 'NJ', office: 'New Jersey Division of Consumer Affairs', address: '124 Halsey St', city: 'Newark', stateAbbr: 'NJ', zip: '07102', phone: '(973) 504-6200', complaintUrl: 'https://www.njconsumeraffairs.gov/consumers/Pages/Consumer-Complaint-Form.aspx' },
  NM: { state: 'New Mexico', stateCode: 'NM', office: 'New Mexico Attorney General', address: '408 Galisteo St', city: 'Santa Fe', stateAbbr: 'NM', zip: '87501', phone: '(505) 827-6000', complaintUrl: 'https://www.nmag.gov/resources/complaint-form.aspx' },
  NY: { state: 'New York', stateCode: 'NY', office: 'New York Attorney General', address: 'The Capitol', city: 'Albany', stateAbbr: 'NY', zip: '12224-0341', phone: '(800) 771-7755', complaintUrl: 'https://ag.ny.gov/complaint-forms' },
  NC: { state: 'North Carolina', stateCode: 'NC', office: 'North Carolina Attorney General', address: '9001 Mail Service Center', city: 'Raleigh', stateAbbr: 'NC', zip: '27699-9001', phone: '(877) 566-7226', complaintUrl: 'https://ncdoj.gov/protecting-consumers/where-to-file-a-consumer-complaint/' },
  ND: { state: 'North Dakota', stateCode: 'ND', office: 'North Dakota Attorney General', address: 'State Capitol, 600 E Boulevard Ave Dept 125', city: 'Bismarck', stateAbbr: 'ND', zip: '58505-0040', phone: '(701) 328-2210', complaintUrl: 'https://attorneygeneral.nd.gov/consumer-resources/consumer-complaints' },
  OH: { state: 'Ohio', stateCode: 'OH', office: 'Ohio Attorney General', address: '30 E Broad St 14th Floor', city: 'Columbus', stateAbbr: 'OH', zip: '43215', phone: '(800) 282-0515', complaintUrl: 'https://www.ohioattorneygeneral.gov/Individuals-and-Families/Consumers/File-a-Complaint' },
  OK: { state: 'Oklahoma', stateCode: 'OK', office: 'Oklahoma Attorney General', address: '313 NE 21st St', city: 'Oklahoma City', stateAbbr: 'OK', zip: '73105', phone: '(405) 521-2029', complaintUrl: 'https://www.oag.ok.gov/consumer-protection' },
  OR: { state: 'Oregon', stateCode: 'OR', office: 'Oregon Department of Justice', address: '1162 Court St NE', city: 'Salem', stateAbbr: 'OR', zip: '97301-4096', phone: '(877) 877-9392', complaintUrl: 'https://www.doj.state.or.us/consumer-protection/file-a-complaint/' },
  PA: { state: 'Pennsylvania', stateCode: 'PA', office: 'Pennsylvania Office of Attorney General', address: 'Strawberry Square 16th Floor', city: 'Harrisburg', stateAbbr: 'PA', zip: '17120', phone: '(717) 787-3391', complaintUrl: 'https://www.attorneygeneral.gov/submit-a-complaint/' },
  RI: { state: 'Rhode Island', stateCode: 'RI', office: 'Rhode Island Attorney General', address: '150 S Main St', city: 'Providence', stateAbbr: 'RI', zip: '02903', phone: '(401) 274-4400', complaintUrl: 'https://riag.ri.gov/civil-division/consumer-protection/file-a-complaint' },
  SC: { state: 'South Carolina', stateCode: 'SC', office: 'South Carolina Attorney General', address: 'PO Box 11549', city: 'Columbia', stateAbbr: 'SC', zip: '29211-1549', phone: '(803) 734-3970', complaintUrl: 'https://www.scag.gov/for-citizens/consumer-protection/' },
  SD: { state: 'South Dakota', stateCode: 'SD', office: 'South Dakota Attorney General', address: '1302 E Hwy 14 Ste 1', city: 'Pierre', stateAbbr: 'SD', zip: '57501-8501', phone: '(605) 773-4400', complaintUrl: 'https://consumer.sd.gov/compliance/consumer.aspx' },
  TN: { state: 'Tennessee', stateCode: 'TN', office: 'Tennessee Attorney General', address: 'PO Box 20207', city: 'Nashville', stateAbbr: 'TN', zip: '37202-0207', phone: '(615) 741-3491', complaintUrl: 'https://www.tn.gov/attorneygeneral/consumer-protection/consumer-resources/file-a-complaint.html' },
  TX: { state: 'Texas', stateCode: 'TX', office: 'Texas Attorney General', address: 'PO Box 12548', city: 'Austin', stateAbbr: 'TX', zip: '78711-2548', phone: '(800) 621-0508', complaintUrl: 'https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint' },
  UT: { state: 'Utah', stateCode: 'UT', office: 'Utah Attorney General', address: '350 N State St Ste 230', city: 'Salt Lake City', stateAbbr: 'UT', zip: '84114-0810', phone: '(801) 538-9600', complaintUrl: 'https://attorneygeneral.utah.gov/contact/complaint-process/' },
  VT: { state: 'Vermont', stateCode: 'VT', office: 'Vermont Attorney General', address: '109 State St', city: 'Montpelier', stateAbbr: 'VT', zip: '05609-1001', phone: '(802) 828-3171', complaintUrl: 'https://ago.vermont.gov/consumer-assistance-program/file-a-complaint-form-request/' },
  VA: { state: 'Virginia', stateCode: 'VA', office: 'Virginia Attorney General', address: '202 N Ninth St', city: 'Richmond', stateAbbr: 'VA', zip: '23219', phone: '(800) 552-9963', complaintUrl: 'https://www.oag.state.va.us/consumer-protection/index.php/file-a-complaint' },
  WA: { state: 'Washington', stateCode: 'WA', office: 'Washington Attorney General', address: '800 Fifth Ave Ste 2000', city: 'Seattle', stateAbbr: 'WA', zip: '98104-3188', phone: '(800) 551-4636', complaintUrl: 'https://www.atg.wa.gov/file-complaint' },
  WV: { state: 'West Virginia', stateCode: 'WV', office: 'West Virginia Attorney General', address: 'PO Box 1789', city: 'Charleston', stateAbbr: 'WV', zip: '25326-1789', phone: '(800) 368-8808', complaintUrl: 'https://ago.wv.gov/Pages/consumer-complaints.aspx' },
  WI: { state: 'Wisconsin', stateCode: 'WI', office: 'Wisconsin Department of Agriculture', address: 'PO Box 8911', city: 'Madison', stateAbbr: 'WI', zip: '53708-8911', phone: '(800) 422-7128', complaintUrl: 'https://www.doj.state.wi.us/dls/consumer-protection/consumer-complaints' },
  WY: { state: 'Wyoming', stateCode: 'WY', office: 'Wyoming Attorney General', address: '200 W 24th St', city: 'Cheyenne', stateAbbr: 'WY', zip: '82002-0028', phone: '(307) 777-7841', complaintUrl: 'https://ag.wyo.gov/consumer-protection' },
  DC: { state: 'District of Columbia', stateCode: 'DC', office: 'DC Office of the Attorney General', address: '400 6th St NW', city: 'Washington', stateAbbr: 'DC', zip: '20001', phone: '(202) 442-9828', complaintUrl: 'https://oag.dc.gov/consumer-protection/consumer-protection-complaints' },
};

export function getAGAddress(stateCode: string): StateAGAddress | null {
  return STATE_AG_ADDRESSES[stateCode.toUpperCase()] ?? null;
}

export function formatAGAddressForLetter(ag: StateAGAddress): string {
  return `${ag.office}\n${ag.address}\n${ag.city}, ${ag.stateAbbr} ${ag.zip}`;
}

/** Alias used by cfpbComplaintGenerator — maps stateCode → { name, address } */
export const stateAGAddresses: Record<string, { name: string; address: string }> = Object.fromEntries(
  Object.entries(STATE_AG_ADDRESSES).map(([code, ag]) => [
    code,
    { name: ag.office, address: formatAGAddressForLetter(ag) },
  ])
);
