import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { ChevronLeft, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const QUESTIONS = [
  {
    id: 1,
    question: "What are the hours or kms on the asset? Please enter whole numbers — without a decimal point.",
    isTextInput: true
  },
  {
    id: 2,
    question: "Is the asset due for a service?",
    options: [
      { label: "Yes", fault: true },
      { label: "No", fault: false }
    ]
  },
  {
    id: 3,
    question: "Do you hold the appropriate License, Qualification or Competency to operate this asset? If you answer NO — please do not operate this asset and see the General Manager.",
    options: [
      { label: "Yes", fault: false },
      { label: "No", fault: true }
    ]
  },
  {
    id: 4,
    question: "Are you Fit for Duty? You are free from Drugs, Alcohol or any medications that may affect your ability to operate this asset safely. If you answer NO — please do not operate this asset and see the General Manager.",
    options: [
      { label: "Yes", fault: false },
      { label: "No", fault: true }
    ]
  },
  {
    id: 5,
    question: "Do you understand that you must wear the appropriate Personal Protective Equipment when completing the Prestart and on an operational site?\n- Long Pants & Long-Sleeved Shirt with Sleeves rolled down.\n- Steel-capped boots — laces must be done up.\n- Safety Glasses if required.\n- Gloves if required.\n- Dust mask if required.",
    options: [
      { label: "I understand what the PPE requirements are.", fault: false },
      { label: "I do not understand the PPE requirements — please see the General Manager for further training.", fault: true }
    ]
  },
  {
    id: 6,
    question: "You have read and understand the Safe Work Method Statement and will follow the control measures to ensure the residual risk of operating this machine is at its lowest level.",
    options: [
      { label: "Yes", fault: false },
      { label: "No", fault: true }
    ]
  },
  {
    id: 7,
    question: "Confirm that engine oil, hydraulic oil, coolant, water and fuel are not leaking on the ground or side of the engine. Check and top up any reservoirs that are below the recommended levels.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There is a fault — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 8,
    question: "Tracks, Tyres & Wheel Assembly.\n- Strike the tyres to ensure that tyres are inflated to the correct pressure.\n- Visually inspect the tyres/tracks for tread integrity (good condition).\n- Visually check wheels/track assembly for security, including the wheel nuts, the wheel nut indicators and fasteners.\n- Check the wheel hubs/track rollers for any leaks and or any deformity.\n- Inspect track tension and condition where applicable.",
    options: [
      { label: "Yes, confirmed that the Tyres/Tracks and Wheel assembly are in a serviceable condition.", fault: false },
      { label: "There is damage and I have filled out a fault repair request and handed it to the General Manager.", fault: true },
      { label: "Tyres/Tracks require monitoring for replacement soon.", fault: false }
    ]
  },
  {
    id: 9,
    question: "Confirm that you have applied grease to all grease points.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "The grease points do not work — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 10,
    question: "General Body Condition.\n- Confirm that all Windows are secure, have no damage and are clean.\n- Confirm that there are no cracks on the windscreens.\n- Confirm that your windscreen wipers are working and that your washers operate with water.\n- Confirm that all mudguards and mud flaps are attached and are in good order.\n- Confirm that there is no damage to any panels or visible damage to structural cross members.\n- Confirm the engine bay is clean and free from foreign objects.\n- All guards are secure and present.",
    options: [
      { label: "Confirmed that the General body condition is roadworthy.", fault: false },
      { label: "There is a problem with my general body condition. I have filled out a fault repair request and handed it to the General Manager. If required Tag out the asset.", fault: true }
    ]
  },
  {
    id: 11,
    question: "Lights and Warning Devices\n- Confirm that all lights, including clearance lights, are fitted and operating.\n- Confirm that all reflectors have no damage and that the operation is correct: headlights, clearance and taillights, indicators, and brake lights.\n- Confirm that instruments are operational: gauges and lights working (including brake fail indicator or gauges).\n- Confirm that the safety alarms are working — Reverse Beeper or Squawker and steering wheel horn.\n- Confirm that the Reversing Camera is working and operational.",
    options: [
      { label: "Confirmed that all Lights and Warning Devices are working.", fault: false },
      { label: "There is a problem with my lights or warning devices. I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 12,
    question: "Confirm that your E-Stop is working. Start the engine and press the E-Stop, and everything should shut down.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "The E-Stop is not working. I have tagged out the asset — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 13,
    question: "Confirm that a fire extinguisher is attached to the asset. The extinguisher has been serviced within the last six months and secured to the asset.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There is a problem with the fire suppression system on this asset — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 14,
    question: "Confirm that the Battery is secure, the terminals are cleaned, and the battery cover is there.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There is a problem with the battery — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 15,
    question: "Brakes and Air Systems:\n- Confirm that there are NO air leaks and that you have drained condensation from air tanks.\n- Confirm that there are no brake failure warning lights indicating a failure.\n- Confirm that all the pressure/vacuum gauges are working.",
    options: [
      { label: "Confirmed that the air and brake systems are roadworthy and that there are no air leaks.", fault: false },
      { label: "There is a problem with the brake or air systems — I have filled out a fault repair request and handed it to the General Manager. Tag out the asset.", fault: true },
      { label: "N/A — Not Applicable.", fault: false }
    ]
  },
  {
    id: 16,
    question: "Confirm that your steering is working correctly. Move your steering wheel from lock to lock to ensure smooth movement.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There is a problem with the steering — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 17,
    question: "Confirm that the loading bucket is in serviceable condition, free from cracks and that the cutting edge is secured.",
    options: [
      { label: "Loader Bucket edge is serviceable.", fault: false },
      { label: "The bucket requires some repairs — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 18,
    question: "Confirm that the safety stickers are present, not faded, and in good condition so that people can read and understand them.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There are stickers missing or need replacing — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 19,
    question: "Confirm that my two-way radio is working, that I'm on the correct channel, and that the volume is turned up. Check that the office can hear you by asking them a question and getting a positive communication response.",
    options: [
      { label: "Confirmed", fault: false },
      { label: "There is a problem communication system. I have tagged out this asset — I have filled out a fault repair request and handed it to the General Manager.", fault: true }
    ]
  },
  {
    id: 20,
    question: "Any General Comments you wish to raise about the roadworthiness of your asset.",
    isTextArea: true
  }
];

export default function PreStart() {
  const navigate = useNavigate();
  const { company } = useCompany();
  const [user, setUser] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [answers, setAnswers] = useState({});
  const [generalComments, setGeneralComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const u = await base44.auth.me().catch(() => null);
      setUser(u);

      const params = new URLSearchParams(window.location.search);
      const equipId = params.get('equipment_id');
      if (equipId) {
        const results = await base44.entities.Equipment.filter({ id: equipId }).catch(() => []);
        if (results.length > 0) setEquipment(results[0]);
      }

      // Find worker's active clock-in to get job site
      if (u && company?.id) {
        const active = await base44.entities.TimeEntry.filter({ company_id: company.id, worker_email: u.email, status: 'active' }).catch(() => []);
        if (active.length > 0) setActiveJob({ id: active[0].job_id, name: active[0].job_name, number: active[0].job_number });
      }
    };
    init();
  }, [company]);

  const setAnswer = (questionId, optionLabel) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionLabel }));
  };

  const allAnswered = QUESTIONS.every(q => {
    if (q.isTextArea) return true; // optional
    if (q.isTextInput) return answers[q.id] && answers[q.id].toString().trim() !== '';
    return answers[q.id] !== undefined;
  });

  const handleSubmit = async () => {
    if (!allAnswered) {
      toast.error('Please answer all questions before submitting.');
      return;
    }
    setSaving(true);

    // Check if any answer is a fault
    const hasFaults = QUESTIONS.some(q => {
      if (q.isTextArea || q.isTextInput) return false;
      const selectedLabel = answers[q.id];
      const selectedOption = q.options?.find(o => o.label === selectedLabel);
      return selectedOption?.fault === true;
    });

    await base44.entities.PreStart.create({
      company_id: company?.id,
      equipment_id: equipment?.id || '',
      equipment_name: equipment?.name || 'Unknown',
      worker_email: user?.email || '',
      worker_name: user?.full_name || '',
      job_id: activeJob?.id || '',
      job_name: activeJob?.name || '',
      job_number: activeJob?.number || '',
      date: format(new Date(), 'yyyy-MM-dd'),
      answers,
      general_comments: generalComments,
      has_faults: hasFaults,
      status: hasFaults ? 'fault' : 'pass',
    });

    toast.success('Pre-start submitted!');
    setSaving(false);
    navigate('/equipment');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-14 pb-4 flex items-center gap-4 sticky top-0 bg-background z-10 border-b border-border">
        <button onClick={() => navigate('/equipment')}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black truncate">Pre-Start Checklist</h1>
          {equipment && <p className="text-xs text-primary font-semibold truncate">{equipment.name} · #{equipment.equipment_id}{activeJob ? ` · ${activeJob.name}` : ''}</p>}
        </div>
      </div>

      {/* Progress */}
      <div className="px-6 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">{Object.keys(answers).length} / {QUESTIONS.filter(q => !q.isTextArea).length} answered</p>
          <p className="text-xs text-primary font-semibold">{Math.round((Object.keys(answers).length / QUESTIONS.filter(q => !q.isTextArea).length) * 100)}%</p>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${(Object.keys(answers).length / QUESTIONS.filter(q => !q.isTextArea).length) * 100}%` }} />
        </div>
      </div>

      {/* Questions */}
      <div className="px-6 space-y-4 pb-44">
        {QUESTIONS.map(q => (
          <div key={q.id} className={`bg-card border rounded-2xl p-4 transition-all ${answers[q.id] !== undefined ? 'border-primary/30' : 'border-border'}`}>
            <p className="text-xs font-black text-primary mb-1">Q{q.id}</p>
            <p className="font-semibold text-sm leading-relaxed mb-3 whitespace-pre-line">{q.question}</p>

            {q.isTextArea ? (
              <textarea
                value={generalComments}
                onChange={e => setGeneralComments(e.target.value)}
                placeholder="Enter any comments..."
                rows={3}
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            ) : q.isTextInput ? (
              <input
                type="number"
                value={answers[q.id] || ''}
                onChange={e => setAnswer(q.id, e.target.value)}
                placeholder="Enter your answer"
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <div className="space-y-2">
                {q.options.map((opt, idx) => {
                  const selected = answers[q.id] === opt.label;
                  return (
                    <button key={idx} onClick={() => setAnswer(q.id, opt.label)}
                      className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                        selected
                          ? opt.fault
                            ? 'bg-red-500/15 border-red-500/50 text-red-400'
                            : 'bg-green-500/15 border-green-500/50 text-green-400'
                          : 'bg-muted/50 border-border text-foreground'
                      }`}>
                      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                        selected
                          ? opt.fault ? 'border-red-400 bg-red-400' : 'border-green-400 bg-green-400'
                          : 'border-muted-foreground/40'
                      }`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm leading-relaxed">{opt.label}</span>
                      {selected && opt.fault && <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5 ml-auto" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit Button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-8 bg-background border-t-2 border-border shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
        <button onClick={handleSubmit} disabled={saving || !allAnswered}
          className="w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:bg-secondary disabled:text-muted-foreground"
          style={allAnswered ? { backgroundColor: '#10B981', color: '#000' } : {}}>
          {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />}
          {saving ? 'Submitting...' : 'Submit Pre-Start'}
        </button>
        {!allAnswered && (
          <p className="text-center text-xs text-muted-foreground mt-2">Answer all questions to submit</p>
        )}
      </div>
    </div>
  );
}