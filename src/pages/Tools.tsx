import React, { useState, useRef } from "react";
import {
  Wrench,
  QrCode,
  Scan,
  Contact,
  Download,
  UploadCloud,
  Calculator,
  ArrowLeft,
  Trash2,
  Plus
} from "lucide-react";
import QRCode from "react-qr-code";
import Papa from "papaparse";
import { useAppContext } from "../context/AppContext";
import { motion, AnimatePresence } from "motion/react";
import { v4 as uuidv4 } from "uuid";

export function Tools() {
  const { negativeItems, contacts, addContact, removeContact, addNegativeItems } = useAppContext();
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // QR Code State
  const [qrValue, setQrValue] = useState("https://annualcreditreport.com");
  
  // Debt Calculator State
  const [debtCalc, setDebtCalc] = useState({ balance: 5000, rate: 19.9, payment: 200 });

  // Contact State
  const [newContact, setNewContact] = useState({ name: "", type: "Bureau", address: "", phone: "" });

  const handleExportCSV = () => {
    if (negativeItems.length === 0) {
      alert("No negative items to export.");
      return;
    }
    const csv = Papa.unparse(negativeItems);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "negative_items_export.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: (results) => {
        try {
          const importedItems = results.data
            .filter((row: any) => row.creditor && row.accountNumber)
            .map((row: any) => ({
              id: uuidv4(),
              creditor: row.creditor,
              accountNumber: row.accountNumber,
              bureau: row.bureau || "Equifax",
              status: row.status || "Negative",
              type: row.type || "Collection",
              balance: row.balance || "$0",
              dateOpened: row.dateOpened || new Date().toLocaleDateString(),
            }));

          if (importedItems.length > 0) {
            addNegativeItems(importedItems);
            alert(`Successfully imported ${importedItems.length} items.`);
          } else {
            alert("No valid items found in CSV. Ensure columns 'creditor' and 'accountNumber' exist.");
          }
        } catch (error) {
          alert("Error parsing CSV file.");
        }
      }
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddContact = () => {
    if (!newContact.name || !newContact.address) {
      alert("Name and Address are required.");
      return;
    }
    addContact({
      id: uuidv4(),
      ...newContact
    });
    setNewContact({ name: "", type: "Bureau", address: "", phone: "" });
  };

  const calculatePayoff = () => {
    const { balance, rate, payment } = debtCalc;
    const monthlyRate = rate / 100 / 12;
    
    if (payment <= balance * monthlyRate) {
      return { error: "Payment too low to cover monthly interest!" };
    }
    
    let currentBalance = balance;
    let months = 0;
    let totalInterest = 0;

    while (currentBalance > 0 && months < 1200) {
      const interest = currentBalance * monthlyRate;
      totalInterest += interest;
      currentBalance = currentBalance + interest - payment;
      months++;
    }

    return { months, totalInterest, error: null };
  };

  const payoffResult = calculatePayoff();

  const toolsList = [
    {
      id: "qr",
      name: "QR Code Generator",
      desc: "Create scannable links for your dispute letters or payment portals.",
      icon: QrCode,
      color: "text-[#ff00ff]",
      bg: "bg-[#ff00ff]/10",
      border: "border-[#ff00ff]/30",
      action: () => setActiveTool("qr")
    },
    {
      id: "calc",
      name: "Debt Calculator",
      desc: "Simulate payoff strategies and their potential impact on your score.",
      icon: Calculator,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      border: "border-blue-400/30",
      action: () => setActiveTool("calc")
    },
    {
      id: "export",
      name: "CSV Export",
      desc: "Download your negative items and dispute history for offline analysis.",
      icon: Download,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/30",
      action: handleExportCSV
    },
    {
      id: "scanner",
      name: "Document Scanner",
      desc: "Use your device camera to digitize physical mail and responses.",
      icon: Scan,
      color: "text-[#00ffff]",
      bg: "bg-[#00ffff]/10",
      border: "border-[#00ffff]/30",
      action: () => alert("Document Scanner module requires native camera permissions. Coming soon.")
    },
    {
      id: "address",
      name: "Address Book",
      desc: "Manage contact information for credit bureaus and creditors.",
      icon: Contact,
      color: "text-[#ff9900]",
      bg: "bg-[#ff9900]/10",
      border: "border-[#ff9900]/30",
      action: () => setActiveTool("address")
    },
    {
      id: "import",
      name: "Bulk Import",
      desc: "Upload historical dispute data from other software via CSV.",
      icon: UploadCloud,
      color: "text-zinc-400",
      bg: "bg-zinc-800",
      border: "border-zinc-700",
      action: () => fileInputRef.current?.click()
    },
  ];

  const renderGrid = () => (
    <motion.div 
      key="grid"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleBulkImport} 
        className="hidden" 
        accept=".csv"
      />
      {toolsList.map((tool, index) => {
        const Icon = tool.icon;
        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            key={tool.id}
            onClick={tool.action}
            className={`cyber-panel p-6 flex flex-col items-start gap-4 hover:border-white/50 transition-colors cursor-pointer group ${tool.border}`}
          >
            <div
              className={`p-3 rounded-lg ${tool.bg} ${tool.border} border group-hover:shadow-[0_0_15px_currentColor] transition-shadow ${tool.color}`}
            >
              <Icon size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">
                {tool.name}
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {tool.desc}
              </p>
            </div>
            <button
              className={`mt-auto text-xs font-mono font-bold uppercase tracking-wider ${tool.color} opacity-70 group-hover:opacity-100 transition-opacity flex items-center gap-1`}
            >
              LAUNCH_TOOL <span className="text-lg leading-none">›</span>
            </button>
          </motion.div>
        );
      })}
    </motion.div>
  );

  const renderQRTool = () => (
    <motion.div 
      key="qr"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="cyber-panel p-6 max-w-md mx-auto"
    >
      <button 
        onClick={() => setActiveTool(null)}
        className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 text-sm font-mono transition-colors"
      >
        <ArrowLeft size={16} /> BACK_TO_TOOLS
      </button>
      
      <h3 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
        <QrCode className="text-[#ff00ff]" />
        QR CODE GENERATOR
      </h3>
      
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Target URL / Text</label>
          <input 
            type="text" 
            className="cyber-input w-full border-[#ff00ff]/30 focus:border-[#ff00ff]"
            value={qrValue}
            onChange={(e) => setQrValue(e.target.value)}
            placeholder="https://..."
          />
        </div>
        
        <div className="bg-white p-4 rounded-lg flex justify-center items-center shadow-[0_0_30px_rgba(255,0,255,0.2)]">
          <QRCode 
            value={qrValue || "https://example.com"} 
            size={200}
            fgColor="#000000"
            bgColor="#ffffff"
            level="H"
          />
        </div>
        
        <p className="text-xs text-zinc-500 text-center font-mono">
          Scan this code with any mobile device to open the link.
        </p>
      </div>
    </motion.div>
  );

  const renderAddressBook = () => (
    <motion.div 
      key="address"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="cyber-panel p-6 max-w-4xl mx-auto"
    >
      <button 
        onClick={() => setActiveTool(null)}
        className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 text-sm font-mono transition-colors"
      >
        <ArrowLeft size={16} /> BACK_TO_TOOLS
      </button>
      
      <h3 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
        <Contact className="text-[#ff9900]" />
        ADDRESS BOOK
      </h3>
      
      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-4">
          <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Add New Contact</h4>
          <div className="space-y-3">
            <input 
              type="text" 
              placeholder="Name (e.g., Equifax)" 
              className="cyber-input w-full border-[#ff9900]/30 focus:border-[#ff9900]"
              value={newContact.name}
              onChange={(e) => setNewContact({...newContact, name: e.target.value})}
            />
            <select 
              className="cyber-input w-full border-[#ff9900]/30 focus:border-[#ff9900]"
              value={newContact.type}
              onChange={(e) => setNewContact({...newContact, type: e.target.value})}
            >
              <option value="Bureau">Credit Bureau</option>
              <option value="Creditor">Creditor</option>
              <option value="Collection">Collection Agency</option>
              <option value="Other">Other</option>
            </select>
            <textarea 
              placeholder="Full Mailing Address" 
              className="cyber-input w-full border-[#ff9900]/30 focus:border-[#ff9900] h-24 resize-none"
              value={newContact.address}
              onChange={(e) => setNewContact({...newContact, address: e.target.value})}
            />
            <input 
              type="text" 
              placeholder="Phone (Optional)" 
              className="cyber-input w-full border-[#ff9900]/30 focus:border-[#ff9900]"
              value={newContact.phone}
              onChange={(e) => setNewContact({...newContact, phone: e.target.value})}
            />
            <button 
              onClick={handleAddContact}
              className="cyber-button-orange w-full flex items-center justify-center gap-2"
            >
              <Plus size={16} /> ADD CONTACT
            </button>
          </div>
        </div>
        
        <div className="md:col-span-2 space-y-4">
          <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Saved Contacts</h4>
          {contacts.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-zinc-800 rounded-lg text-zinc-500 font-mono">
              NO_CONTACTS_FOUND
            </div>
          ) : (
            <div className="grid gap-3">
              {contacts.map((contact) => (
                <div key={contact.id} className="p-4 bg-[#111] border border-zinc-800 rounded-lg flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="font-bold text-white">{contact.name}</h5>
                      <span className="cyber-badge text-[10px] px-2 py-0.5 text-[#ff9900] border-[#ff9900]">
                        {contact.type.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-400 whitespace-pre-line">{contact.address}</p>
                    {contact.phone && <p className="text-xs text-zinc-500 mt-2 font-mono">{contact.phone}</p>}
                  </div>
                  <button 
                    onClick={() => removeContact(contact.id)}
                    className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  const renderCalcTool = () => (
    <motion.div 
      key="calc"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="cyber-panel p-6 max-w-2xl mx-auto"
    >
      <button 
        onClick={() => setActiveTool(null)}
        className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 text-sm font-mono transition-colors"
      >
        <ArrowLeft size={16} /> BACK_TO_TOOLS
      </button>
      
      <h3 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
        <Calculator className="text-blue-400" />
        DEBT PAYOFF CALCULATOR
      </h3>
      
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Current Balance ($)</label>
            <input 
              type="number" 
              className="cyber-input w-full border-blue-400/30 focus:border-blue-400"
              value={debtCalc.balance}
              onChange={(e) => setDebtCalc({...debtCalc, balance: Number(e.target.value)})}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Interest Rate (APR %)</label>
            <input 
              type="number" 
              step="0.1"
              className="cyber-input w-full border-blue-400/30 focus:border-blue-400"
              value={debtCalc.rate}
              onChange={(e) => setDebtCalc({...debtCalc, rate: Number(e.target.value)})}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Monthly Payment ($)</label>
            <input 
              type="number" 
              className="cyber-input w-full border-blue-400/30 focus:border-blue-400"
              value={debtCalc.payment}
              onChange={(e) => setDebtCalc({...debtCalc, payment: Number(e.target.value)})}
            />
          </div>
        </div>
        
        <div className="bg-[#111] border border-zinc-800 rounded-lg p-6 flex flex-col justify-center">
          <h4 className="text-sm font-bold text-zinc-400 mb-4 uppercase tracking-wider">Projection Results</h4>
          
          {payoffResult.error ? (
            <div className="text-red-400 text-sm font-mono bg-red-400/10 p-3 rounded border border-red-400/30">
              {payoffResult.error}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-xs text-zinc-500 font-mono mb-1">TIME TO PAYOFF</p>
                <p className="text-3xl font-bold text-white">
                  {Math.floor(payoffResult.months! / 12)}<span className="text-lg text-zinc-400">y</span> {payoffResult.months! % 12}<span className="text-lg text-zinc-400">m</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 font-mono mb-1">TOTAL INTEREST PAID</p>
                <p className="text-2xl font-bold text-blue-400">
                  ${payoffResult.totalInterest!.toFixed(2)}
                </p>
              </div>
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-xs text-zinc-500 font-mono mb-1">TOTAL COST</p>
                <p className="text-xl font-bold text-white">
                  ${(debtCalc.balance + payoffResult.totalInterest!).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      {!activeTool && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Wrench className="text-zinc-400" />
            UTILITIES & TOOLS
          </h2>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {activeTool === "qr" && renderQRTool()}
        {activeTool === "calc" && renderCalcTool()}
        {activeTool === "address" && renderAddressBook()}
        {activeTool === null && renderGrid()}
      </AnimatePresence>
    </div>
  );
}
