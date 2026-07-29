import React, { useState } from "react";
import {
  User,
  ShieldCheck,
  Key,
  Smartphone,
  Mail,
  MapPin,
  CreditCard,
  Save,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";

export function Profile() {
  const { personalInfo, updatePersonalInfo, security, updateSecurity, clearData } = useAppContext();
  const [localInfo, setLocalInfo] = useState(personalInfo);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    updatePersonalInfo(localInfo);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const toggleSecurity = (key: keyof typeof security) => {
    updateSecurity({ [key]: !security[key] });
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete all your data? This cannot be undone.")) {
      await clearData();
      setLocalInfo(personalInfo); // Reset local state to default
      alert("All data has been deleted.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <User className="text-[#00ffff]" />
            PROFILE & SECURITY
          </h2>
          <p className="text-zinc-400 mt-1">
            Manage your personal information and account security.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={handleSave}
            className={`cyber-button flex items-center gap-2 ${isSaved ? 'border-emerald-400 text-emerald-400' : 'border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10'}`}
          >
            <Save size={16} />
            {isSaved ? 'SAVED!' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="cyber-panel p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
              <User className="text-[#00ffff]" size={20} />
              PERSONAL INFORMATION
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  First Name
                </label>
                <input
                  type="text"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.firstName}
                  onChange={(e) =>
                    setLocalInfo({
                      ...localInfo,
                      firstName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  Last Name
                </label>
                <input
                  type="text"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.lastName}
                  onChange={(e) =>
                    setLocalInfo({
                      ...localInfo,
                      lastName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Mail size={14} /> Email
                </label>
                <input
                  type="email"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.email}
                  onChange={(e) =>
                    setLocalInfo({ ...localInfo, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Smartphone size={14} /> Phone
                </label>
                <input
                  type="tel"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.phone}
                  onChange={(e) =>
                    setLocalInfo({ ...localInfo, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <MapPin size={14} /> Address
                </label>
                <input
                  type="text"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.address}
                  onChange={(e) =>
                    setLocalInfo({
                      ...localInfo,
                      address: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  City
                </label>
                <input
                  type="text"
                  className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                  value={localInfo.city}
                  onChange={(e) =>
                    setLocalInfo({ ...localInfo, city: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">
                    State
                  </label>
                  <input
                    type="text"
                    className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                    value={localInfo.state}
                    onChange={(e) =>
                      setLocalInfo({
                        ...localInfo,
                        state: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">
                    ZIP
                  </label>
                  <input
                    type="text"
                    className="cyber-input w-full border-[#00ffff]/30 focus:border-[#00ffff] focus:shadow-[0_0_10px_rgba(0,255,255,0.2)]"
                    value={localInfo.zip}
                    onChange={(e) =>
                      setLocalInfo({ ...localInfo, zip: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="cyber-panel p-6 border-[#ff00ff]/30">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
              <CreditCard className="text-[#ff00ff]" size={20} />
              SENSITIVE DATA
            </h3>
            <p className="text-xs text-zinc-400 mb-4 font-mono">
              WARNING: This data is used for generating dispute letters. It is
              stored locally on your device.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  Social Security Number
                </label>
                <input
                  type="password"
                  className="cyber-input w-full border-[#ff00ff]/30 focus:border-[#ff00ff] focus:shadow-[0_0_10px_rgba(255,0,255,0.2)]"
                  value={localInfo.ssn}
                  onChange={(e) =>
                    setLocalInfo({ ...localInfo, ssn: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  Date of Birth
                </label>
                <input
                  type="text"
                  className="cyber-input w-full border-[#ff00ff]/30 focus:border-[#ff00ff] focus:shadow-[0_0_10px_rgba(255,0,255,0.2)]"
                  value={localInfo.dob}
                  onChange={(e) =>
                    setLocalInfo({ ...localInfo, dob: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="cyber-panel p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <ShieldCheck className="text-emerald-400" size={20} />
              SECURITY
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-[#111] border border-zinc-800 rounded">
                <div className="flex items-center gap-3">
                  <Key size={16} className="text-zinc-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      App Lock (PIN)
                    </h4>
                    <p className="text-xs text-zinc-500">
                      Require PIN to open app
                    </p>
                  </div>
                </div>
                <div 
                  onClick={() => toggleSecurity('appLock')}
                  className={`w-10 h-5 rounded-full relative cursor-pointer border transition-colors ${security.appLock ? 'bg-emerald-400/20 border-emerald-400' : 'bg-zinc-800 border-zinc-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${security.appLock ? 'right-1 bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'left-1 bg-zinc-500'}`}></div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-[#111] border border-zinc-800 rounded">
                <div className="flex items-center gap-3">
                  <Smartphone size={16} className="text-zinc-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Biometric Login
                    </h4>
                    <p className="text-xs text-zinc-500">
                      Use FaceID / TouchID
                    </p>
                  </div>
                </div>
                <div 
                  onClick={() => toggleSecurity('biometricLogin')}
                  className={`w-10 h-5 rounded-full relative cursor-pointer border transition-colors ${security.biometricLogin ? 'bg-emerald-400/20 border-emerald-400' : 'bg-zinc-800 border-zinc-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${security.biometricLogin ? 'right-1 bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'left-1 bg-zinc-500'}`}></div>
                </div>
              </div>

              <button className="w-full cyber-button text-xs py-2 border-zinc-600 text-zinc-400 hover:text-white hover:border-white">
                CHANGE PIN CODE
              </button>
            </div>
          </div>

          <div className="cyber-panel p-6 border-red-500/30 bg-red-500/5">
            <h3 className="text-sm font-bold text-red-500 mb-2 font-mono">
              DANGER_ZONE
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Deleting your profile will permanently erase all local data,
              including imported reports, negative items, and generated letters.
            </p>
            <button 
              onClick={handleDelete}
              className="cyber-button text-xs py-2 w-full border-red-500 text-red-500 hover:bg-red-500/10"
            >
              DELETE PROFILE DATA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
