select base.*,
base1.FSN
from(
select
'n pack' as GRN_Type,
'RFID lotting' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w1.weightunit as b2clot,
w.weighttypeid,
wt.toquantity,
wt.Toquantity/w1.conversiontobase as No_Of_Units,

wt.reftype,
c.name as city,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn

from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and activityid in (54)
and w.weighttypeid=23
and wt.transfertext='GRN to GRN'
group by wt.id

union all

select
'n pack' as GRN_Type,
'B2C Lotting' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w1.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity * substring_index(w.weightunit,' *',1) as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn


from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and w.weighttypeid=23
and activityid in (54)
and wt.transfertext='B2CLotting to Secondary Storage'
group by wt.id


union all

select
'n pack' as GRN_Type,
'B2C Lotting_CB' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w1.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn

from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and w.weighttypeid=23
and activityid in (54)
and wt.transfertext='B2CLotting to Crate Building'
group by wt.id


union all

select
'n pack' as GRN_Type,
'PO to GRN' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w1.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity/w1.conversiontobase as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn

from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and activityid in (54)
and w.weighttypeid=23
and wt.transfertext='PO to GRN'
group by wt.id

union all

select
'n pack' as GRN_Type,
'PO to Grading' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w1.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity /w1.conversiontobase as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn
from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
left join AsgardUser au on au.id=wt.updatedby
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and activityid in (54)
and w.weighttypeid=23
and wt.transfertext='PO to Grading'
group by wt.id

union all


select
'Residual' as GRN_Type,
'Residual' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity /w.conversiontobase as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn

from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and activityid in (51)
and wt.purchaseorderdetailsid is not null
group by wt.id

union all

select
'Residual' as GRN_Type,
'Regrading to GRN' as Type,
wt.skuid,
wt.Facilityid,
wt.Deliverydate,
w.weightunit,
w.weightunit as b2clot,
w.weighttypeid,
wt.Toquantity,
wt.Toquantity  as No_Of_Units,

wt.reftype,
c.name as City,
wt.refid,
wt.TransferText as TransferText,
wt.Activityid as ActivityId,
addtime(wt.updatedat,'05:30:00') as updatedat,
case when time(addtime(wt.updatedat,'05:30:00'))<='22:00:00' and date(addtime(wt.updatedat,'05:30:00'))between '{{from date}}' and '{{to date}}' then 1 else 0 end as ontime_grn

from
WarehouseTracker wt
left join Weight w on w.id=wt.toweightid
left join
(
select distinct skuid,facilityid,Packingweightid,lotweightid
from
SkuFacilityWeightMap sfwm
where facilityid in (9382)
and Packingweightid is not null
)sfwm
on sfwm.skuid=wt.skuid and sfwm.facilityid in (9382) and sfwm.Packingweightid=w.id
left join Weight w1 on w1.id=sfwm.lotweightid
left join LabourAgency la on la.id=wt.RefId
left join Facility f on f.id=wt.facilityid
left join City c on c.id=f.cityid
left join AsgardUser au on au.id=wt.updatedby
where wt.facilityid in (9382)
and wt.DeliveryDate between date_sub('{{from date}}', interval 2 day) and date_add('{{to date}}', interval 2 day)
and date(wt.updatedat) between '{{from date}}' and '{{to date}}'
and activityid in (51)
and wt.transfertext='Regrading to GRN'
group by wt.id
)base
left join(
select DeliveryDate,
CityId,
weightunit,
FSN
from(
select   so.DeliveryDate as DeliveryDate,
date_format(so.DeliveryDate,"%Y_%u") as YW,
ci.id as CityId,
ci.name as City,
w.conversiontobase,
f.id as FacilityId,
f.name as Facility,
sod.id as SaleOrderDetailsId,
so.id as SaleOrderId,
so.SubType as SOSubType,
so.Type as SOType,
so.Status as SOStatus,
c.id as CustomerId,
c.name as Customer,
bp.id as BusinessPartnerId,
bp.Name as Buisnesspartnername,
s.id as Skuid,
s.Name as Sku,
w.weightunit as weightunit,
s.CategoryId as SkuCategoryId,
pei.fsncode as FSN,
w.BaseWeight as baseweight,
sod.lotweightid as lotweightId,
sod.saleprice as saleprice,
sod.Deleted as Deleted,
sod.SkuQuantity as OrderQuantity,
sod.BilledQuantity as BilledQuantity,
sod.FulfilledQuantity as FulfilledQuantity,
sod.ReturnQuantity as ReturnsQuantity,
case when so.subtype=15 then 0 else sod.SkuQuantity / w.ConversionToBase end as Orderlot,
sod.billedquantity / w.ConversionToBase as billedlot,
sod.fulfilledquantity / w.ConversionToBase as Fulfilledlot,
case when s.categoryid=4 then 'XD'
when (s.name like "%Ugao%" or s.Name like "%Kyari%" or s.Name like "%Phulwa%" or s.Name like "%Farmerr%" or s.Name like "%FlowerAura%" or s.Name like "%Hoovu%") then 'Brands'
else 'FnV' end as Cat,
sod.SkuQuantity * sco.conversiontokgs as OrderKgs,
sod.billedquantity * sco.conversiontokgs as BilledKgs,
sod.fulfilledquantity * sco.conversiontokgs as FulfilledKgs
from
SaleOrder so
left join SaleOrderDetails sod on sod.SaleOrderId = so.id
left join SaleOrderAdditionalInfo soa on soa.SaleOrderId=so.id
left join Weight w on sod.LotWeightId=w.id
left join Customer c on c.id = so.CustomerId
left join CustomerAttribute ca on ca.CustomerId = c.id and ca.Deleted = 0
left join Sku s on sod.SkuId = s.id
join BusinessPartner bp on bp.id = ca.BusinessPartnerId
left join City ci on ci.id = so.CityId
left join Facility f on so.FacilityId=f.id
left join SkuSubCategory ssc on ssc.id=s.subcategoryid
left join
(
select pei.externalProductName ,pei.fsnCode ,pei.externalProductId ,externalProductUnit ,pei.hsnCode,pei.skuid,pei.lotWeightId,pei.subResellerId,cityid, pei.externalOutletId, pei.Identifier
from
vormir.ProductExternalInternalMapping pei
left join City c on c.id=pei.cityid
where c.id=2
)pei on so.CityId=pei.CityId and sod.SkuId=pei.skuid and sod.lotWeightId=pei.lotWeightId and pei.externalOutletId = so.CustomerId
left join SkuConfiguration sco on sco.skuid=s.id
where so.DeliveryDate -interval 1 day between '{{from date}}' and '{{to date}}'
and ca.InvoiceType=0
and (ifnull(bp.partnertype, 'B2B') = 'B2C' or bp.id=106)  and so.Type in (1,2,7,9)
and f.id in (9382)
and ((sod.deleted = 0) or (sod.Deleted = 1 and sod.SkuQuantity != sod.BilledQuantity))
and so.Deleted=0
and so.status=5
group by so.DeliveryDate,sod.SKuid,so.FacilityId,so.CustomerId,sod.LotWeightId,so.id
)base
group by DeliveryDate,
CityId,
weightunit,
FSN
)base1 on base1.weightunit=base.b2clot and base1.deliverydate-interval 1 day=base.Deliverydate
