//---------------------------------------------------------------------
// Aggregate providers
//---------------------------------------------------------------------

import {Constraint, isVariable, resolve, toValue} from "../join";
import * as providers from "./index";

export abstract class Aggregate extends Constraint {
  static isAggregate = true;
  static AttributeMapping = {
    "value": 0,
    "given": 1,
    "per": 2,
  }

  projectionVars: any[];
  groupVars: any[];
  resolvedGroup: any[];
  resolvedProjection: any[];
  resolvedAggregate: {group: any[], projection: any[], value: any};
  aggregateResults: any;
  value: any;

  constructor(id: string, args: any[], returns: any[]) {
    super(id, args, returns);
    let [value, given, per] = args;
    if(given === undefined) {
      this.projectionVars = [];
    } else if(isVariable(given)) {
      this.projectionVars = [given];
    } else {
      this.projectionVars = given;
    }
    if(per === undefined) {
      this.groupVars = [];
    } else if(isVariable(per)) {
      this.groupVars = [per];
    } else {
      this.groupVars = per;
    }
    this.value = value;
    this.resolvedGroup = [];
    this.resolvedProjection = [];
    this.resolvedAggregate = {group: this.resolvedGroup, projection: this.resolvedProjection, value: undefined};
    this.aggregateResults = {};
  }

  resolveAggregate(prefix) {
    resolve(this.projectionVars, prefix, this.resolvedProjection)
    resolve(this.groupVars, prefix, this.resolvedGroup)
    let resolved = this.resolvedAggregate;
    resolved.value = toValue(this.value, prefix);
    return resolved;
  }

  aggregate(rows: any[]) {
    let groupKeys = [];
    let groups = {};
    for(let row of rows) {
      let {group, projection, value} = this.resolveAggregate(row);
      let groupKey = "[]";
      if(group.length !== 0) {
        groupKey = JSON.stringify(group);
      }
      let groupValues = groups[groupKey];
      if(groupValues === undefined) {
        groupKeys.push(groupKey);
        groupValues = groups[groupKey] = {};
      }
      let projectionKey = JSON.stringify(projection);
      if(groupValues[projectionKey] === undefined) {
        groupValues[projectionKey] = true;
        this.adjustAggregate(groupValues, value, projection);
      }
    }
    for(let key of groupKeys) {
      this.finalizeGroup(groups[key]);
    }
    this.aggregateResults = groups;
    return groups;
  }

  resolveProposal(proposal, prefix) {
    if(proposal.index) {
      return [proposal.index.result];
    }
    return [];
  }

  test(prefix) {
    let {group} = this.resolveAggregate(prefix);
    let resultGroup = this.aggregateResults[JSON.stringify(group)];
    if(resultGroup !== undefined) {
      let returns = resolve(this.returns, prefix, this.resolvedReturns);
      return returns[0] === resultGroup.result;
    }
  }

  getProposal(multiIndex, proposed, prefix) {
    let {group} = this.resolveAggregate(prefix);
    let resultGroup = this.aggregateResults[JSON.stringify(group)];
    let proposal = this.proposalObject;
    if(resultGroup) {
      proposal.index = resultGroup
      proposal.providing = proposed;
      proposal.cardinality = 1;
    } else {
      proposal.index = undefined;
      proposal.providing = proposed;
      proposal.cardinality = 0;
    }
    return proposal;
  }

  finalizeGroup(group) {}

  abstract adjustAggregate(group, value, projection): any;
}

export class Sum extends Aggregate {
  adjustAggregate(group, value, projection) {
    if(group.result === undefined) {
      group.result = value;
    } else {
      group.result += value;
    }
    return group.result;
  }
}

export class Count extends Aggregate {
  adjustAggregate(group, value, projection) {
    if(group.result === undefined) {
      group.result = 1;
    } else {
      group.result += 1;
    }
    return group.result;
  }
}

export class Average extends Aggregate {
  adjustAggregate(group, value, projection) {
    if(group.count === undefined) {
      group.count = 1;
      group.sum = value;
      group.result = group.sum / group.count;
    } else {
      group.count += 1;
      group.sum += value;
      group.result = group.sum / group.count;
    }
    return group.result;
  }
}

export class Min extends Aggregate {
  adjustAggregate(group, value, projection) {
    if(group.result === undefined) {
      group.result = value;
    } else if(value < group.result) {
      group.result = value;
    }
    return group.result;
  }
}

export class Max extends Aggregate {
  adjustAggregate(group, value, projection) {
    if(group.result === undefined) {
      group.result = value;
    } else if(value > group.result) {
      group.result = value;
    }
    return group.result;
  }
}

export class Join extends Aggregate {
  static AttributeMapping = {
    "value": 0,
    "given": 1,
    "per": 2,
    "ordinal": 3,
    "separator": 4,
  }

  ordinal : any;
  separator : any;

  constructor(id: string, args: any[], returns: any[]) {
    super(id, args, returns);
    this.ordinal = args[3]
    this.separator = args[4]
  }

  aggregate(rows: any[]) {
    let groupKeys = [];
    let groups = {};
    for(let row of rows) {
      resolve(this.projectionVars, row, this.resolvedProjection)
      resolve(this.groupVars, row, this.resolvedGroup)
      let group = this.resolvedAggregate.group;
      let projection = this.resolvedAggregate.projection;
      let value = toValue(this.value, row);
      let ordinal = toValue(this.ordinal, row);
      let separator = toValue(this.separator, row);

      if (separator === undefined) separator = "";

      let groupKey = "[]";
      if(group.length !== 0) {
        groupKey = JSON.stringify(group);
      }
      let groupValues = groups[groupKey];
      if(groupValues === undefined) {
        groupKeys.push(groupKey);
        groupValues = groups[groupKey] = {result:[]};
      }
      let projectionKey = JSON.stringify(projection);
      if(groupValues[projectionKey] === undefined) {
        groupValues[projectionKey] = true;
        groupValues.result.push({value: value, ordinal:ordinal, separator:separator})
      }
    }

    for (let g in groups) {
        let s = groups[g].result.sort((a, b) => 
                                      {if (a.ordinal > b.ordinal) return 1;
                                       if (a.ordinal === b.ordinal) return 0;
                                       return -1;})
        let len = s.length
        let result = ""
        for (var i=0; i<len; ++i) {
            // this means that the sep assocated with a value
            // is the one which occurs before the value
            if (i != 0) result += s[i].separator
            result += s[i].value 
        }
        groups[g].result = result;
    }
    this.aggregateResults = groups;
    return groups;
  }
  // unused but to keep mr. class happy
  adjustAggregate(group, value, projection) {}
}

providers.provide("sum", Sum);
providers.provide("count", Count);
providers.provide("average", Average);
providers.provide("join", Join);
providers.provide("min", Min);
providers.provide("max", Max);
