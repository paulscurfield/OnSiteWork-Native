import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { onsiteApi } from '@/api/supabase/adapter';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireSupabaseUuid = (value, label) => {
  const trimmed = String(value || '').trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a valid Supabase UUID.`);
  }
  return trimmed;
};

const resolveSingleCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('You must be signed in to complete a pre-start.');
  }
  if (companyRows.length === 0) {
    throw new Error('No Supabase company is available for this account.');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. Company selection is required before completing a pre-start.');
  }
  return companyRows[0];
};

export default function PreStart() {
  const navigate = useNavigate();
  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [answers, setAnswers] = useState({});
  const [generalComments, setGeneralComments] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    const init = async () => {
      setLoading(true);
      setLoadError('');
      setSupabaseCompany(null);
      setEquipment(null);
      setActiveJob(null);
      setJobs([]);
      setSelectedJobId('');

      try {
        const params = new URLSearchParams(window.location.search);
        const equipmentParam = params.get('equipment_id');
        if (!equipmentParam) {
          throw new Error('Equipment is required to complete a pre-start.');
        }
        const equipmentId = requireSupabaseUuid(equipmentParam, 'Equipment ID');

        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== loadRequestIdRef.current) return;

        const resolvedCompany = resolveSingleCompany(profile, companyRows);
        const memberRows = await onsiteApi.tables.companyMembers.filter({
          company_id: resolvedCompany.id,
          user_id: profile.id,
        });
        if (requestId !== loadRequestIdRef.current) return;

        if (!memberRows[0]) {
          throw new Error('Your Supabase company membership could not be confirmed.');
        }

        const [equipmentRows, activeJobs, activeTimeEntry] = await Promise.all([
          onsiteApi.tables.equipment.filter({
            company_id: resolvedCompany.id,
            id: equipmentId,
          }),
          onsiteApi.tables.jobs.filter({
            company_id: resolvedCompany.id,
            status: 'active',
          }),
          onsiteApi.tables.timeEntries.getMyActive(resolvedCompany.id),
        ]);
        if (requestId !== loadRequestIdRef.current) return;

        const resolvedEquipment = equipmentRows[0];
        if (!resolvedEquipment) {
          throw new Error('Equipment is unavailable or you do not have access to it.');
        }

        let resolvedActiveJob = null;
        if (activeTimeEntry && !activeTimeEntry.job_id) {
          throw new Error('Your active clocked-in job could not be resolved safely.');
        }
        if (activeTimeEntry?.job_id) {
          const activeJobId = activeTimeEntry.job_id;
          resolvedActiveJob = activeJobs.find(job => job['id'] === activeJobId) || null;
          if (!resolvedActiveJob) {
            const activeJobRows = await onsiteApi.tables.jobs.filter({
              company_id: resolvedCompany.id,
              id: activeTimeEntry.job_id,
            });
            if (requestId !== loadRequestIdRef.current) return;
            resolvedActiveJob = activeJobRows[0] || null;
          }
          if (!resolvedActiveJob) {
            throw new Error('Your active clocked-in job could not be resolved safely.');
          }
        }

        setSupabaseCompany(resolvedCompany);
        setEquipment(resolvedEquipment);
        setJobs(activeJobs);
        setActiveJob(resolvedActiveJob);
        setSelectedJobId(resolvedActiveJob?.['id'] || '');
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('Failed to load Supabase pre-start page:', error);
        setLoadError(error?.message || 'Failed to load pre-start checklist.');
        setSupabaseCompany(null);
        setEquipment(null);
        setActiveJob(null);
        setJobs([]);
        setSelectedJobId('');
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, []);

  const selectedJob = activeJob || jobs.find(job => job.id === selectedJobId) || null;

  const setAnswer = (questionId, optionLabel) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionLabel }));
  };

  const allAnswered = QUESTIONS.every(q => {
    if (q.isTextArea) return true; // optional
    if (q.isTextInput) return answers[q.id] && answers[q.id].toString().trim() !== '';
    return answers[q.id] !== undefined;
  });

  const handleSubmit = async () => {
    if (savingRef.current) return;
    if (loading || loadError || !supabaseCompany || !equipment) {
      toast.error('Pre-start checklist is not ready to submit.');
      return;
    }
    if (!allAnswered) {
      toast.error('Please answer all questions before submitting.');
      return;
    }
    if (!selectedJob) {
      toast.error('Please select a job site before submitting.');
      return;
    }
    savingRef.current = true;
    setSaving(true);

    const hasFaults = QUESTIONS.some(q => {
      if (q.isTextArea || q.isTextInput) return false;
      const selectedLabel = answers[q.id];
      const selectedOption = q.options?.find(o => o.label === selectedLabel);
      return selectedOption?.fault === true;
    });

    try {
      await onsiteApi.tables.preStarts.createWorker({
        company_id: supabaseCompany.id,
        equipment_id: equipment.id,
        job_id: selectedJob.id,
        date: format(new Date(), 'yyyy-MM-dd'),
        answers,
        general_comments: generalComments,
        has_faults: hasFaults,
      });

      if (!mountedRef.current) return;
      toast.success('Pre-start submitted!');
      navigate('/equipment');
    } catch (error) {
      if (!mountedRef.current) return;
      console.error('Failed to submit Supabase pre-start:', error);
      toast.error('Failed to submit pre-start');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  const submitDisabled = saving || loading || Boolean(loadError) || !allAnswered || !selectedJob || !equipment || !supabaseCompany;

  if (loading || loadError) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-6 pt-14 pb-4 flex items-center gap-4 sticky top-0 bg-background z-10 border-b border-border">
          <button onClick={() => navigate('/equipment')}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black truncate">Pre-Start Checklist</h1>
          </div>
        </div>
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          {loading ? (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Loading pre-start checklist...</p>
            </>
          ) : (
            <>
              <AlertTriangle className="w-8 h-8 text-red-400 mb-4" />
              <p className="font-bold text-sm mb-2">Pre-start unavailable</p>
              <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
              <button
                onClick={() => navigate('/equipment')}
                className="mt-6 px-4 py-2 rounded-xl bg-secondary text-sm font-semibold"
              >
                Back to Equipment
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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
          {equipment && <p className="text-xs text-primary font-semibold truncate">{equipment.name} · #{equipment.equipment_id}{selectedJob ? ` · ${selectedJob.job_name}` : ''}</p>}
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

      {/* Job Selector */}
      <div className="px-6 pb-2">
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-black text-primary mb-1">JOB SITE</p>
          {activeJob ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              <p className="font-bold text-sm">{activeJob.job_name}{activeJob.job_number ? ` #${activeJob.job_number}` : ''}</p>
              <span className="text-[10px] bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full font-semibold ml-auto">Clocked In</span>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-2">You're not clocked in - select the job site for this pre-start:</p>
              <select
                value={selectedJobId}
                onChange={event => setSelectedJobId(event.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a job site</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.job_name}{job.job_number ? ` #${job.job_number}` : ''}</option>
                ))}
              </select>
              {jobs.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">No active jobs available.</p>
              )}
            </div>
          )}
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
        <button onClick={handleSubmit} disabled={submitDisabled}
          className="w-full py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:bg-secondary disabled:text-muted-foreground"
          style={!submitDisabled ? { backgroundColor: '#10B981', color: '#000' } : {}}>
          {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />}
          {saving ? 'Submitting...' : 'Submit Pre-Start'}
        </button>
        {!allAnswered && (
          <p className="text-center text-xs text-muted-foreground mt-2">Answer all questions to submit</p>
        )}
        {allAnswered && !selectedJob && (
          <p className="text-center text-xs text-muted-foreground mt-2">Select a job site to submit</p>
        )}
      </div>
    </div>
  );
}
